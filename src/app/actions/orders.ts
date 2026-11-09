"use server";

import { reserveOrderResources } from "@/lib/order-reservation";
import { money } from "@/lib/money";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toPiconero, fromPiconero } from "@/lib/monero-rpc";
import { publishEvent, recordBehavior } from "@/lib/events";
import { requirePgpArmoredMessage } from "@/lib/zero-knowledge";
import { calculateVendorLevelFromSales, getBadgesForUser } from "@/lib/meritocracy";
import { creditPlatformRevenue, creditPlatformRevenueFromEscrow } from "@/lib/platform-revenue";

const STANDARD_MARKET_COMMISSION = 0.04;

/**
 * PLACE ORDER ACTION
 * Wallet balance is the only accepted settlement method.
 */
export async function placeOrderAction(formData: FormData) {
  const session = await verifyAuth();
  const productId = formData.get("productId")?.toString();
  const pgpMessage = formData.get("pgpmessage")?.toString();
  const shippingOptionId = formData.get("shipping_option")?.toString();
  let destinationTab = "orders";

  if (!productId) return redirect("/market?error=MissingProduct");

  return await prisma.$transaction(async (tx) => {
    // 1. Fetch Product and Buyer
    const product = await tx.product.findUnique({
      where: { id: productId },
      include: { vendor: true, shippingOptions: true }
    });
    const buyer = await tx.user.findUnique({ where: { id: session.userId as string } });

    if (!product || !buyer) throw new Error("EntityNotFound");
    if (product.vendorId === buyer.id) throw new Error("SelfPurchaseNotAllowed");
    if (product.isPaused || product.moderationStatus !== "APPROVED" || product.vendor.isVacationMode || product.vendor.isBanned) {
      throw new Error("ProductUnavailable");
    }
    if (product.quantity <= 0) throw new Error("OutOfStock");
    const encryptedShippingPayload = product.productType === "PHYSICAL" && !product.isAutoshop
      ? requirePgpArmoredMessage(pgpMessage, "ShippingPayload")
      : undefined;

    // 2. Calculate Final Price (Atomic Logic)
    let shippingName = "Standard Delivery";
    let piconeroShipping = BigInt(0);

    if (product.productType === "PHYSICAL" && product.shippingOptions.length > 0) {
       const option = product.shippingOptions.find(o => o.id === shippingOptionId);
       if (!option) throw new Error("InvalidShippingOption");
       shippingName = option.name;
       piconeroShipping = toPiconero(option.costXMR);
    }

    const piconeroProduct = toPiconero(product.priceXMR);
    const piconeroTotal = piconeroProduct + piconeroShipping;

    // Fetch Dynamic Commission
    const config = await tx.marketConfig.upsert({
       where: { id: "global_config" },
       update: {},
       create: { id: "global_config", globalCommission: STANDARD_MARKET_COMMISSION }
    });

    const marketFeePercent = config.globalCommission;
    const piconeroMarketFee = toPiconero(money(fromPiconero(piconeroTotal).mul(marketFeePercent)));

    const finalPriceXMR = fromPiconero(piconeroTotal);
    const marketFeeXMR = fromPiconero(piconeroMarketFee);
    const shippingCostXMR = fromPiconero(piconeroShipping);

    // 3. Handle Wallet Payment Logic
    if (money(buyer.walletBalanceXMR).lt(finalPriceXMR)) throw new Error("InsufficientBalance");

       await reserveOrderResources(tx, { buyerId: buyer.id, productId: product.id, amount: finalPriceXMR });

       // Digital products and autoshop items are delivered immediately.
       if (product.productType === "DIGITAL" || product.isAutoshop) {
          let digitalToken = product.digitalPayload || "NO_PAYLOAD_CONFIGURED";

          // Handle Bulk Autoshop Pool
          if (product.isBulkAutoshop) {
             const pooledItem = await tx.autoshopItem.findFirst({
                where: { productId: product.id, isSold: false }
             });
             if (!pooledItem) throw new Error("Out of Stock (Pool empty)");
             digitalToken = pooledItem.content;
             const claimedItem = await tx.autoshopItem.updateMany({ where: { id: pooledItem.id, isSold: false }, data: { isSold: true } });
             if (claimedItem.count !== 1) throw new Error("OutOfStock");
          }

          // Create Completed Order immediately
          const order = await tx.order.create({
            data: {
              buyerId: buyer.id,
              vendorId: product.vendorId,
              productId: product.id,
              status: "COMPLETED",
              totalXMR: finalPriceXMR,
              marketFeeXMR: marketFeeXMR,
              shippingCostXMR: shippingCostXMR,
              shippingOptionName: shippingName,
              digitalPayloadReceived: digitalToken,
              paymentType: "WALLET",
              paymentConfirmed: true
            }
          });

          // Finalize Funds Transfer
          const vendorCut = money(finalPriceXMR).minus(marketFeeXMR);
          const completedSales = await tx.order.count({
            where: { vendorId: product.vendorId, status: "COMPLETED" },
          });
          const vendorLevel = calculateVendorLevelFromSales(completedSales);
          await tx.user.update({
            where: { id: product.vendorId },
            data: {
              walletBalanceXMR: { increment: vendorCut },
              xp: { increment: 10 },
              dispatchedOrdersCount: { increment: 1 },
              level: vendorLevel,
              badges: getBadgesForUser("VENDOR", vendorLevel).join(" ") || null,
            }
          });

          // Fund Platform
          await creditPlatformRevenue({
            tx,
            amountXMR: marketFeeXMR,
            source: "ORDER_FEE",
            orderId: order.id,
            buyerId: buyer.id,
          });

          await tx.appEvent.create({
            data: {
              type: "order.completed",
              aggregate: "order",
              aggregateId: order.id,
              actorId: buyer.id,
              payload: { productId: product.id, vendorId: product.vendorId, totalXMR: finalPriceXMR },
            },
          });
          destinationTab = "history";

       } else {
          // Standard Escrow Order
          const order = await tx.order.create({
            data: {
              buyerId: buyer.id,
              vendorId: product.vendorId,
              productId: product.id,
              status: "PENDING",
              totalXMR: finalPriceXMR,
              marketFeeXMR: marketFeeXMR,
              shippingCostXMR: shippingCostXMR,
              shippingOptionName: shippingName,
              shippingPayload: encryptedShippingPayload,
              isMultisig: false,
              paymentType: "WALLET",
              paymentConfirmed: true
            }
          });

          // Lock funds in platform escrow
          await tx.platformWallet.upsert({
            where: { id: "market_wallet" },
            update: { escrowTotal: { increment: finalPriceXMR } },
            create: { id: "market_wallet", balanceXMR: 0, escrowTotal: finalPriceXMR }
          });

          await tx.appEvent.create({
            data: {
              type: "order.created",
              aggregate: "order",
              aggregateId: order.id,
              actorId: buyer.id,
              payload: { productId: product.id, vendorId: product.vendorId, totalXMR: finalPriceXMR, isMultisig: false },
            },
          });
       }

    // 5. Create Notification
    await tx.notification.create({
      data: {
        userId: product.vendorId,
        type: "ORDER",
        title: "New Incoming Order",
        content: `You received an order for "${product.title}" (${finalPriceXMR.toFixed(4)} XMR).`
      }
    });

    await tx.userBehaviorEvent.create({
      data: {
        userId: buyer.id,
        productId: product.id,
        category: product.category,
        action: "ORDER",
        weight: 5,
      },
    });

  }).then(() => {
     revalidatePath("/market/dashboard/buyer");
     return redirect(`/market/dashboard/buyer?tab=${destinationTab}&success=OrderPlaced`);
  }).catch(err => {
     console.error("Order Failure:", err);
     const publicErrors = new Set(["EntityNotFound", "SelfPurchaseNotAllowed", "ProductUnavailable", "OutOfStock", "InvalidShippingOption", "InsufficientBalance", "ShippingPayloadMustBePgpEncrypted"]);
     const code = err instanceof Error && publicErrors.has(err.message) ? err.message : "OrderFailed";
     return redirect(`/market/product/${encodeURIComponent(productId)}?error=${encodeURIComponent(code)}`);
  });
}

/**
 * UPDATE ORDER STATUS ACTION
 */
export async function updateOrderStatusAction(orderId: string, nextStatus: string, formData?: FormData) {
  if (!["SHIPPED", "COMPLETED"].includes(nextStatus)) throw new Error("InvalidTransition");
  const session = await verifyAuth();

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { vendor: true, buyer: true }
    });

    if (!order) throw new Error("OrderNotFound");

    // Authorization Layer
    if (nextStatus === "SHIPPED") {
       if (order.vendorId !== session.userId) throw new Error("Unauthorized");
       if (order.status !== "PENDING") throw new Error("InvalidTransition");
    }
    if (nextStatus === "COMPLETED") {
       if (order.buyerId !== session.userId && session.role !== "ADMIN") throw new Error("Unauthorized");
       if (order.status !== "SHIPPED") throw new Error("WaitUntilShipped");
    }

    // 2. Perform Status Transition
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        shippedAt: nextStatus === "SHIPPED" ? new Date() : undefined,
        trackingNumber: nextStatus === "SHIPPED"
          ? formData?.get("trackingNumber")?.toString().trim().slice(0, 120) || undefined
          : undefined
      }
    });

    // 3. Handle Completion (Funds Release)
    if (nextStatus === "COMPLETED") {
       const vendorCut = money(order.totalXMR).minus(order.marketFeeXMR);
       const completedSales = await tx.order.count({
         where: { vendorId: order.vendorId, status: "COMPLETED" },
       });
       const vendorLevel = calculateVendorLevelFromSales(completedSales);

       // Transfer cut to vendor
       await tx.user.update({
         where: { id: order.vendorId },
         data: {
            walletBalanceXMR: { increment: vendorCut },
            xp: { increment: 25 },
            dispatchedOrdersCount: { increment: 1 },
            level: vendorLevel,
            badges: getBadgesForUser("VENDOR", vendorLevel).join(" ") || null,
         }
       });

       // Release from Platform Escrow
       await tx.platformWallet.update({
         where: { id: "market_wallet" },
         data: {
            escrowTotal: { decrement: order.totalXMR },
         }
       });
       await creditPlatformRevenueFromEscrow({
         tx,
         amountXMR: order.marketFeeXMR,
         orderId: order.id,
         buyerId: order.buyerId,
       });
    }

    // 4. Notify participants
    await tx.notification.create({
      data: {
        userId: nextStatus === "SHIPPED" ? order.buyerId : order.vendorId,
        type: "ORDER",
        title: `Order Status: ${nextStatus}`,
        content: `Order #${orderId.slice(0, 6)} has been moved to ${nextStatus}.`
      }
    });

    await tx.appEvent.create({
      data: {
        type: "order.status_changed",
        aggregate: "order",
        aggregateId: orderId,
        actorId: session.userId as string,
        payload: { from: order.status, to: nextStatus },
      },
    });

  }).then(() => {
     revalidatePath("/market/dashboard");
     return { success: true };
  }).catch(err => {
     console.error("Status Update Failed:", err);
     const publicErrors = new Set(["OrderNotFound", "Unauthorized", "InvalidTransition", "WaitUntilShipped"]);
     return { error: err instanceof Error && publicErrors.has(err.message) ? err.message : "StatusUpdateFailed" };
  });
}

/**
 * SUBMIT REVIEW ACTION
 */
export async function submitReviewAction(formData: FormData) {
   const session = await verifyAuth();
   const orderId = formData.get("orderId")?.toString();
   const rating = parseInt(formData.get("rating")?.toString() || "5", 10);
   const comment = formData.get("comment")?.toString().trim();

   if (!orderId) return redirect("/market/dashboard/buyer?tab=history&error=MissingOrder");
   if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return redirect("/market/dashboard/buyer?tab=history&error=InvalidRating");
   }
   if (comment && comment.length > 1000) {
      return redirect("/market/dashboard/buyer?tab=history&error=FeedbackTooLong");
   }

   const order = await prisma.order.findUnique({
      where: { id: orderId }
   });

   if (!order || order.buyerId !== session.userId || order.status !== "COMPLETED") {
      return redirect("/market/dashboard/buyer?tab=history&error=ReviewUnavailable");
   }
   if (order.reviewDone) {
      return redirect("/market/dashboard/buyer?tab=history&error=ReviewAlreadySubmitted");
   }

   await prisma.$transaction([
      prisma.review.create({
         data: {
            rating,
            comment: comment || "No comment provided.",
            buyerId: order.buyerId,
            productId: order.productId
         }
      }),
      prisma.order.update({
         where: { id: order.id },
         data: { reviewDone: true }
      }),
      prisma.user.update({
         where: { id: order.vendorId },
         data: { trustScore: { increment: rating >= 4 ? 2 : (rating <= 2 ? -5 : 0) } }
      })
   ]);

   await recordBehavior({
      userId: session.userId as string,
      productId: order.productId,
      action: "REVIEW",
      weight: rating >= 4 ? 3 : 1,
   });
   await publishEvent({
      type: "review.created",
      aggregate: "order",
      aggregateId: order.id,
      actorId: session.userId as string,
      payload: { productId: order.productId, rating },
   });

   revalidatePath(`/market/product/${order.productId}`);
   revalidatePath(`/market/dashboard/buyer`);
   redirect("/market/dashboard/buyer?tab=history&success=FeedbackSubmitted");
}

/**
 * SEND ORDER CHAT MESSAGE
 */
export async function sendOrderChatAction(formData: FormData) {
   const session = await verifyAuth();
   const orderId = formData.get("orderId")?.toString();
   const content = formData.get("content")?.toString();
   const returnTo = formData.get("returnTo")?.toString();

   if (!orderId || !content) return redirect("/market/dashboard/buyer?error=MissingChatData");
   const encryptedContent = requirePgpArmoredMessage(content, "Message");

   // Verify the sender is the buyer or vendor of this specific order
   const order = await prisma.order.findUnique({ where: { id: orderId } });
   if (!order) return redirect("/market/dashboard/buyer?error=OrderNotFound");

   const isParticipant = order.buyerId === session.userId || order.vendorId === session.userId || session.role === "ADMIN";
   if (!isParticipant) return redirect("/market/dashboard/buyer?error=Unauthorized");

   await prisma.orderChat.create({
      data: {
         orderId,
         senderId: session.userId as string,
         content: encryptedContent
      }
   });

   revalidatePath("/market/dashboard/buyer");
   revalidatePath("/market/dashboard/vendor");
   if (returnTo?.startsWith("/market/dashboard/vendor") || returnTo?.startsWith("/market/dashboard/buyer")) {
      return redirect(returnTo);
   }
   return redirect(`/market/dashboard/buyer?tab=orders&orderId=${orderId}&success=MessageSent`);
}
