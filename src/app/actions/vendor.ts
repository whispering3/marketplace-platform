"use server";

import { queueRevenuePayout } from "@/lib/revenue-payouts";
import { randomUUID } from "node:crypto";

import { requestWithdrawal } from "@/lib/withdrawals";
import { validateMoneroAddress } from "@/lib/monero-rpc";
import { money, parseMoney } from "@/lib/money";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createSession, verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { triggerAutoSiphon } from "@/app/actions/monero-daemon";
import { publishEvent, recordBehavior } from "@/lib/events";
import { upsertProductSearchDocument } from "@/lib/search";
import { getVendorBondQuote, VENDOR_BOND_USD } from "@/lib/vendor-bond";
import { creditPlatformRevenue } from "@/lib/platform-revenue";
import { getVendorVacationBlockers } from "@/lib/vendor-vacation";
import { normalizeUsername } from "@/lib/auth-hardening";

/**
 * LEGENDARY SECURITY: EXIF/METADATA SCRUBBER
 * Surgically removes APP1 (EXIF) segments from JPEG byte streams.
 */
function stripPngMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 8 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    return buffer;
  }

  const chunks: Uint8Array[] = [buffer.subarray(0, 8)];
  let offset = 8;
  const metadataChunks = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + length;
    if (nextOffset > buffer.length) return buffer;

    if (!metadataChunks.has(type)) {
      chunks.push(buffer.subarray(offset, nextOffset));
    }
    offset = nextOffset;
  }

  return Buffer.concat(chunks);
}

function stripJpegMetadata(buffer: Buffer): Buffer {
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return buffer;

  const chunks: Uint8Array[] = [buffer.subarray(0, 2)];
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xFF || offset + 4 > buffer.length) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xDA) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const length = buffer.readUInt16BE(offset + 2);
    const nextOffset = offset + 2 + length;
    if (nextOffset > buffer.length) return buffer;

    const isMetadata = marker === 0xE1 || marker === 0xED || marker === 0xFE;
    if (!isMetadata) {
      chunks.push(buffer.subarray(offset, nextOffset));
    }
    offset = nextOffset;
  }

  return Buffer.concat(chunks);
}

function scrubImageMetadata(base64: string): string {
  try {
     const parts = base64.split(",");
     if (parts.length !== 2) return base64;
     const buffer = Buffer.from(parts[1], 'base64');

     let cleanBuffer: Uint8Array = buffer;
     if (base64.includes("image/jpeg")) {
        cleanBuffer = stripJpegMetadata(buffer);
     } else if (base64.includes("image/png")) {
        cleanBuffer = stripPngMetadata(buffer);
     }

     return parts[0] + "," + Buffer.from(cleanBuffer).toString('base64');
  } catch (e) {
     console.error("Scrubbing failed:", e);
     return base64;
  }
}

export async function publishProductAction(formData: FormData) {
  const session = await verifyAuth();

  if (!session || !session.userId) {
     return redirect("/auth/login?error=SessionExpired");
  }

  const user = await prisma.user.findUnique({
     where: { id: session.userId as string }
  });

  if (user?.role !== "VENDOR" && user?.role !== "ADMIN") {
      return redirect("/market/vendor/bond?error=NotVendor");
  }

  const title = formData.get("title")?.toString().trim();
  const quantity = parseInt(formData.get("quantity")?.toString() || "1", 10);
  let priceXMR;
  try { priceXMR = parseMoney(formData.get("price")?.toString() || "0"); }
  catch { return redirect("/market/dashboard/vendor?tab=products&error=InvalidPrice"); }
  const category = formData.get("category")?.toString().trim();
  const originShipsFrom = formData.get("ships_from")?.toString().trim();
  const shipsTo = formData.get("ships_to")?.toString().trim();
  const description = formData.get("desc")?.toString().trim();
  const fullDescription = formData.get("full_desc")?.toString().trim();
  const tags = formData.get("tags")?.toString().trim();
  const productType = formData.get("product_type")?.toString() || "PHYSICAL";

  let image1 = formData.get("image1")?.toString().trim() || "";
  let image2 = formData.get("image2")?.toString().trim() || "";
  let image3 = formData.get("image3")?.toString().trim() || "";
  let imageUrl = image1;

  if (!title || title.length > 120 || priceXMR.lte(0) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000 || !category || category.length > 100 || !description || description.length > 500 || (fullDescription?.length || 0) > 10_000 || (tags?.length || 0) > 500 || (originShipsFrom?.length || 0) > 120 || (shipsTo?.length || 0) > 120 || !["PHYSICAL", "DIGITAL"].includes(productType)) {
      return redirect("/market/dashboard/vendor?tab=products&error=MissingFields");
  }

  // SCRUBBING GATE (OpSec Protocol)
  try {
    image1 = normalizeProductImage(image1);
    image2 = normalizeProductImage(image2);
    image3 = normalizeProductImage(image3);
    imageUrl = image1;
  } catch (error) {
    const code = error instanceof Error ? error.message : "InvalidProductImage";
    return redirect(`/market/dashboard/vendor?tab=products&error=${encodeURIComponent(code)}`);
  }

  try {
     const autoApproveProduct = user.role === "ADMIN";
     const newProduct = await prisma.product.create({
        data: {
           title,
           quantity,
           priceXMR,
           category,
           originShipsFrom: originShipsFrom || "Undefined",
           shipsTo: shipsTo || "Worldwide",
           description,
           fullDescription,
           tags,
           subcategory: formData.get("subcategory")?.toString() || "Other",
           productType,
           vendorId: user.id,
           isPaused: !autoApproveProduct,
           moderationStatus: autoApproveProduct ? "APPROVED" : "PENDING_REVIEW",
           moderationNote: autoApproveProduct ? null : "Awaiting catalog review",
           imageUrl,
           image1,
           image2,
           image3,
           image4: "",
           image5: "",
           image6: ""
        }
     });

     if (productType === "PHYSICAL") {
        const shippingOptions = [];
        for (let i = 1; i <= 5; i++) {
           const sName = formData.get(`shipping_name_${i}`)?.toString();
           const sCost = parseMoney(formData.get(`shipping_cost_${i}`)?.toString() || "0");
           if (sCost.lt(0)) throw new Error("InvalidShippingCost");
           if (sName && sName.trim() !== "") {
              shippingOptions.push({ name: sName, costXMR: sCost, productId: newProduct.id });
           }
        }
        if (shippingOptions.length > 0) {
           await prisma.shippingOption.createMany({ data: shippingOptions });
        }
     }

     await upsertProductSearchDocument(newProduct.id);
     await publishEvent({
       type: "product.created",
       aggregate: "product",
       aggregateId: newProduct.id,
       actorId: user.id,
       payload: { category, productType, priceXMR: priceXMR.toFixed(12) },
     });

     return redirect(`/market/dashboard/vendor?tab=products&success=${autoApproveProduct ? "ProductCreated" : "ProductPendingReview"}`);
  } catch(error) {
     console.error("Error creating product:", error);
     return redirect("/market/dashboard/vendor?tab=products&error=DatabaseFailure");
  }
}

export async function updateProductAction(formData: FormData) {
   const session = await verifyAuth();
   const productId = formData.get("productId")?.toString();
   if (!session?.userId || !productId) {
      return redirect("/market/dashboard/vendor?tab=products&error=MissingId");
   }

   const user = await prisma.user.findUnique({ where: { id: session.userId as string } });
   const product = await prisma.product.findUnique({ where: { id: productId } });

   if (!user || !product || product.vendorId !== user.id) {
      return redirect("/market/dashboard/vendor?tab=products&error=Unauthorized");
   }

   const title = formData.get("title")?.toString().trim();
   const quantity = parseInt(formData.get("quantity")?.toString() || "1", 10);
   let priceXMR;
   try { priceXMR = parseMoney(formData.get("price")?.toString() || "0"); }
   catch { return redirect("/market/dashboard/vendor?tab=products&error=InvalidPrice"); }
   const category = formData.get("category")?.toString().trim();
   const subcategory = formData.get("subcategory")?.toString().trim() || "Other";
   const originShipsFrom = formData.get("ships_from")?.toString().trim();
   const shipsTo = formData.get("ships_to")?.toString().trim();
   const description = formData.get("desc")?.toString().trim();
   const fullDescription = formData.get("full_desc")?.toString().trim();
   const tags = formData.get("tags")?.toString().trim();
   const productType = formData.get("product_type")?.toString() || "PHYSICAL";
   const deliveryNote = formData.get("shipping_name_1")?.toString().trim();

   let image1 = formData.get("image1")?.toString().trim() || "";
   let image2 = formData.get("image2")?.toString().trim() || "";
   let image3 = formData.get("image3")?.toString().trim() || "";
   let imageUrl = image1;

   if (!title || title.length > 120 || priceXMR.lte(0) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000 || !category || category.length > 100 || !description || description.length > 500 || (fullDescription?.length || 0) > 10_000 || (tags?.length || 0) > 500 || (originShipsFrom?.length || 0) > 120 || (shipsTo?.length || 0) > 120 || (deliveryNote?.length || 0) > 160 || !["PHYSICAL", "DIGITAL"].includes(productType)) {
      return redirect("/market/dashboard/vendor?tab=products&error=InvalidListingUpdate");
   }

   try {
      image1 = normalizeProductImage(image1);
      image2 = normalizeProductImage(image2);
      image3 = normalizeProductImage(image3);
      imageUrl = image1;
   } catch (error) {
      const code = error instanceof Error ? error.message : "InvalidProductImage";
      return redirect(`/market/dashboard/vendor?tab=products&error=${encodeURIComponent(code)}`);
   }

   const autoApproveProduct = user.role === "ADMIN";

   await prisma.$transaction(async (tx) => {
      await tx.product.update({
         where: { id: productId },
         data: {
            title,
            quantity,
            priceXMR,
            category,
            subcategory,
            originShipsFrom: originShipsFrom || "Undefined",
            shipsTo: shipsTo || "Worldwide",
            description,
            fullDescription,
            tags,
            productType,
            imageUrl,
            image1,
            image2,
            image3,
            image4: "",
            image5: "",
            image6: "",
            isPaused: autoApproveProduct ? product.isPaused : true,
            moderationStatus: autoApproveProduct ? "APPROVED" : "PENDING_REVIEW",
            moderationNote: autoApproveProduct ? "Edited by admin vendor account" : "Edited listing awaiting catalog review",
            moderatedAt: autoApproveProduct ? new Date() : null,
            moderatedById: autoApproveProduct ? user.id : null,
         },
      });

      await tx.shippingOption.deleteMany({ where: { productId } });
      if (productType === "PHYSICAL" && deliveryNote) {
         await tx.shippingOption.create({
            data: {
               productId,
               name: deliveryNote,
               costXMR: 0,
            },
         });
      }

      await tx.appEvent.create({
         data: {
            type: "product.updated",
            aggregate: "product",
            aggregateId: productId,
            actorId: user.id,
            payload: { category, subcategory, productType, priceXMR: priceXMR.toFixed(12), requiresReview: !autoApproveProduct },
         },
      });
   });

   await upsertProductSearchDocument(productId);
   revalidatePath("/market");
   revalidatePath("/market/dashboard/vendor");
   return redirect(`/market/dashboard/vendor?tab=products&success=${autoApproveProduct ? "ProductUpdated" : "ProductUpdatePendingReview"}`);
}

export async function buyVendorBondAction() {
  const session = await verifyAuth();
  const bondQuote = await getVendorBondQuote();
  const bondPriceXMR = bondQuote.xmrAmount;

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: session.userId as string } });
    if (!user) throw new Error("User not found");
    if (user.hasPaidBond) throw new Error("Bond already paid");
    if (money(user.walletBalanceXMR).lt(bondPriceXMR)) {
      throw new Error(`Insufficient balance (Need ${bondPriceXMR.toFixed(4)} XMR to secure vendor activation)`);
    }

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        walletBalanceXMR: { decrement: bondPriceXMR },
        hasPaidBond: true,
        role: "VENDOR"
      }
    });

    const adminId = await creditPlatformRevenue({ tx, amountXMR: bondPriceXMR, source: "VENDOR_BOND" });
    const payout = adminId ? await queueRevenuePayout(tx, { userId: adminId, amount: bondPriceXMR, sourceKey: `bond:${user.id}`, address: process.env.ADMIN_XMR_ADDRESS }) : null;

    await tx.financialLog.create({
      data: {
        type: "VENDOR_BOND",
        amountXMR: bondPriceXMR,
        userId: user.id,
        details: `Vendor activation fee paid. USD reference: ${VENDOR_BOND_USD}. XMR/USD: ${bondQuote.xmrUsd.toFixed(2)} (${bondQuote.source}).`,
      },
    });

    await tx.appEvent.create({
      data: {
        type: "vendor.activated",
        aggregate: "user",
        aggregateId: user.id,
        actorId: user.id,
        payload: { bondPriceXMR, usdReference: VENDOR_BOND_USD, xmrUsd: bondQuote.xmrUsd, rateSource: bondQuote.source },
      },
    });

    return { updatedUser, payout };
  }).then(async ({ updatedUser, payout }) => {
    await triggerAutoSiphon(payout?.id);
    await createSession(
      updatedUser.id,
      updatedUser.role,
      updatedUser.username,
      updatedUser.staffId || undefined,
    );
    return redirect("/market/dashboard/vendor?success=BondPaid");
  }).catch(err => {
    if (typeof err?.digest === "string" && err.digest.startsWith("NEXT_REDIRECT")) throw err;
    return redirect("/market/vendor/bond?error=" + encodeURIComponent(err.message));
  });
}

export async function uploadBulkItemsAction(formData: FormData) {
  const session = await verifyAuth();
  const productId = formData.get("productId")?.toString();
  const rawItems = formData.get("items")?.toString();

  if (!productId || productId.length > 64 || !rawItems || rawItems.length > 500_000) return redirect("/market/dashboard/vendor?error=MissingBulkData");

  // Verify the authenticated vendor owns this product
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.vendorId !== session.userId) {
    return redirect("/market/dashboard/vendor?error=Unauthorized");
  }

  const lines = rawItems.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0 || lines.length > 5_000 || lines.some((line) => line.length > 4_096)) {
    return redirect("/market/dashboard/vendor?error=InvalidBulkData");
  }

  await prisma.autoshopItem.createMany({
    data: lines.map(line => ({
      productId,
      content: line
    }))
  });

  await prisma.product.update({
    where: { id: productId },
    data: { isBulkAutoshop: true, quantity: { increment: lines.length } }
  });

  await upsertProductSearchDocument(productId);
  await publishEvent({
    type: "product.bulk_items_uploaded",
    aggregate: "product",
    aggregateId: productId,
    actorId: session.userId as string,
    payload: { count: lines.length },
  });

  revalidatePath("/market/dashboard/vendor");
  return redirect("/market/dashboard/vendor?tab=products&success=BulkItemsUploaded");
}

/**
 * PROMOTE PRODUCT ACTION
 */
export async function promoteProductAction(formData: FormData) {
  const session = await verifyAuth();
  const productId = formData.get("productId")?.toString();
  const tier = formData.get("tier")?.toString();

  if (!productId || !tier) return redirect("/market/dashboard/vendor?error=MissingPromotionData");

  const priceMap: Record<string, number> = { "3": 0.5, "7": 0.75, "15": 1.2 };
  const cost = priceMap[tier];
  if (!cost) return redirect("/market/dashboard/vendor?error=InvalidTier");

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: session.userId as string } });
    const product = await tx.product.findUnique({ where: { id: productId } });

    if (!user || money(user.walletBalanceXMR).lt(cost)) throw new Error("Insufficient balance for promotion");
    if (!product || product.vendorId !== user.id) throw new Error("Product ownership verify failed");
    if (product.isPaused || product.moderationStatus !== "APPROVED") throw new Error("Product must be approved and active before promotion");

    const days = parseInt(tier);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    await tx.user.update({
      where: { id: user.id },
      data: { walletBalanceXMR: { decrement: cost } }
    });

    const adminId = await creditPlatformRevenue({ tx, amountXMR: cost, source: "PROMOTION" });
    const payout = adminId ? await queueRevenuePayout(tx, { userId: adminId, amount: cost, sourceKey: `promotion:${randomUUID()}`, address: process.env.ADMIN_XMR_ADDRESS }) : null;

    await tx.product.update({
      where: { id: productId },
      data: { isPromoted: true, promotedUntil: futureDate }
    });

    return payout;
  }).then(async (payout) => {
    await triggerAutoSiphon(payout?.id);
    await upsertProductSearchDocument(productId);
    await publishEvent({
      type: "product.promoted",
      aggregate: "product",
      aggregateId: productId,
      actorId: session.userId as string,
      payload: { tier, cost },
    });
    revalidatePath("/market");
    return redirect("/market/dashboard/vendor?tab=products&success=Promoted");
  }).catch(err => {
    if (typeof err?.digest === "string" && err.digest.startsWith("NEXT_REDIRECT")) throw err;
    const code = err instanceof Error && ["InsufficientBalance", "RevenueReservationFailed"].includes(err.message) ? err.message : "PromotionFailed";
    return redirect("/market/dashboard/vendor?error=" + encodeURIComponent(code));
  });
}

export async function togglePauseProductAction(formData: FormData) {
   const session = await verifyAuth();
   const productId = formData.get("productId")?.toString();
   if (!productId) return redirect("/market/dashboard/vendor?tab=products&error=MissingId");

   const product = await prisma.product.findUnique({
      where: { id: productId }
   });

   if (!product || product.vendorId !== session.userId) {
      return redirect("/market/dashboard/vendor?tab=products&error=Unauthorized");
   }

   if (product.isPaused && product.moderationStatus !== "APPROVED") {
      return redirect("/market/dashboard/vendor?tab=products&error=AwaitingModeration");
   }

   await prisma.product.update({
      where: { id: productId },
      data: { isPaused: !product.isPaused }
   });

   await upsertProductSearchDocument(productId);
   await publishEvent({
      type: product.isPaused ? "product.resumed" : "product.paused",
      aggregate: "product",
      aggregateId: productId,
      actorId: session.userId as string,
      payload: { previousState: product.isPaused },
   });

   return redirect(`/market/dashboard/vendor?tab=products&success=${product.isPaused ? "Resumed" : "Paused"}`);
}

export async function deleteProductAction(formData: FormData) {
   const session = await verifyAuth();
   const productId = formData.get("productId")?.toString();
   if (!productId) return redirect("/market/dashboard/vendor?tab=products&error=MissingId");

   const product = await prisma.product.findUnique({
      where: { id: productId }
   });

   if (!product || product.vendorId !== session.userId) {
      return redirect("/market/dashboard/vendor?tab=products&error=Unauthorized");
   }

   await prisma.product.delete({
      where: { id: productId }
   });

   await publishEvent({
      type: "product.deleted",
      aggregate: "product",
      aggregateId: productId,
      actorId: session.userId as string,
   });

   return redirect("/market/dashboard/vendor?tab=products&success=Deleted");
}

export async function updateVendorSettingsAction(formData: FormData) {
  const session = await verifyAuth();
  const vendorTerms = formData.get("vendorTerms")?.toString();
  const vacationMode = formData.get("vacationMode") === "yes";

  if (session.role !== "VENDOR" && session.role !== "ADMIN") {
    return redirect("/market?error=VENDOR_ACCESS_REQUIRED");
  }
  if ((vendorTerms?.length || 0) > 10_000) return redirect("/market/dashboard/vendor?tab=settings&error=TermsTooLong");

  const vendor = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: { isVacationMode: true },
  });
  if (!vendor) return redirect("/auth/login");

  if (vacationMode && !vendor.isVacationMode) {
    const blockers = await getVendorVacationBlockers(session.userId as string);
    if (blockers.total > 0) {
      return redirect(`/market/dashboard/vendor?tab=settings&error=VacationBlocked&openOrders=${blockers.openOrders}&openDisputes=${blockers.openDisputes}`);
    }
  }

  await prisma.user.update({
    where: { id: session.userId as string },
    data: {
      vendorTerms,
      isVacationMode: vacationMode
    }
  });

  await recordBehavior({
    userId: session.userId as string,
    action: "VIEW",
    weight: vacationMode ? 0.1 : 0.2,
  });

  return redirect("/market/dashboard/vendor?tab=pgp&success=SettingsUpdated");
}

function normalizeProductImage(value: string) {
  if (!value) return "";
  if (value.length > 350_000) throw new Error("ProductImageTooLarge");
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value)) return value;

  const match = /^data:image\/(png|jpeg);base64,([a-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error("InvalidProductImage");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 256_000) throw new Error("ProductImageTooLarge");
  const isPng = match[1].toLowerCase() === "png" && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const isJpeg = match[1].toLowerCase() === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) throw new Error("InvalidProductImage");
  return scrubImageMetadata(value);
}

export async function addVendorWhitelistAction(formData: FormData) {
  const session = await verifyAuth();
  if (session.role !== "VENDOR" && session.role !== "ADMIN") {
    return redirect("/market?error=VENDOR_ACCESS_REQUIRED");
  }

  const username = normalizeUsername(formData.get("username")?.toString() || "");
  if (!username) return redirect("/market/dashboard/vendor?tab=operations&error=WhitelistUsernameRequired");

  const [buyer, entryCount] = await Promise.all([
    prisma.user.findUnique({ where: { username }, select: { id: true, role: true, isBanned: true } }),
    prisma.vendorWhitelistEntry.count({ where: { vendorId: session.userId as string } }),
  ]);
  if (!buyer || buyer.isBanned || !["BUYER", "VENDOR"].includes(buyer.role) || buyer.id === session.userId) {
    return redirect("/market/dashboard/vendor?tab=operations&error=BuyerNotFound");
  }
  if (entryCount >= 500) return redirect("/market/dashboard/vendor?tab=operations&error=WhitelistLimitReached");

  await prisma.vendorWhitelistEntry.upsert({
    where: { vendorId_buyerId: { vendorId: session.userId as string, buyerId: buyer.id } },
    update: {},
    create: { vendorId: session.userId as string, buyerId: buyer.id },
  });
  revalidatePath("/market/dashboard/vendor");
  return redirect("/market/dashboard/vendor?tab=operations&success=BuyerWhitelisted");
}

export async function removeVendorWhitelistAction(formData: FormData) {
  const session = await verifyAuth();
  if (session.role !== "VENDOR" && session.role !== "ADMIN") {
    return redirect("/market?error=VENDOR_ACCESS_REQUIRED");
  }
  const entryId = formData.get("entryId")?.toString();
  if (!entryId || entryId.length > 64) return redirect("/market/dashboard/vendor?tab=operations&error=InvalidWhitelistEntry");

  await prisma.vendorWhitelistEntry.deleteMany({
    where: { id: entryId, vendorId: session.userId as string },
  });
  revalidatePath("/market/dashboard/vendor");
  return redirect("/market/dashboard/vendor?tab=operations&success=BuyerRemovedFromWhitelist");
}

export async function requestWithdrawalAction(formData: FormData) {
  const session = await verifyAuth();
  const address = formData.get("address")?.toString().trim();
  const pin = formData.get("pin")?.toString();
  if (!address || !pin) return redirect("/market/dashboard/vendor?tab=reports&error=MissingWithdrawalData");
  try {
    const amount = parseMoney(formData.get("amount")?.toString() || "0");
    if (!await validateMoneroAddress(address)) throw new Error("InvalidMoneroAddress");
    await requestWithdrawal(prisma, { userId: session.userId, address, pin, amount });
  } catch (error) {
    const code = error instanceof Error ? error.message : "WithdrawalFailed";
    return redirect(`/market/dashboard/vendor?tab=reports&error=${encodeURIComponent(code)}`);
  }
  revalidatePath("/market/wallet");
  return redirect("/market/dashboard/vendor?tab=reports&success=WithdrawalRequested");
}
