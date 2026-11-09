"use server";

import { money, parseMoney } from "@/lib/money";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { transferWithReceipt, verifyOutgoingTransfer } from "@/lib/monero-rpc";
import { hashPassword } from "@/lib/auth-flow";
import { hashPin, isValidPinFormat } from "@/lib/pin";
import { requiredProductionEnv } from "@/lib/env";
import crypto from "crypto";
import { calculateVendorLevelFromSales, getBadgesForUser } from "@/lib/meritocracy";
import { creditPlatformRevenueFromEscrow } from "@/lib/platform-revenue";

import { MODERATOR_PERMISSIONS, hasStaffPermission, type StaffPermission } from "@/lib/staff-permissions";
import { reviewWithdrawal, reconcileWithdrawal } from "@/lib/withdrawals";
import { isStrongPassword, isValidUsername, normalizeUsername } from "@/lib/auth-hardening";

async function adminPath(tab?: string, status?: string) {
  const session = await verifyAuth();
  const base = session.role === "STAFF" ? "/moderator" : `/${requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev")}`;
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (status) params.set(status.startsWith("error=") ? "error" : "success", status.replace(/^(error|success)=/, ""));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

async function requireStaffPermission(permission: StaffPermission) {
  const session = await verifyAuth();
  if (!session.isStaffVerified) throw new Error("StaffVerificationRequired");
  const staff = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!hasStaffPermission(staff, permission)) throw new Error("Unauthorized");

  return session;
}

async function writeAdminAudit(
  session: Awaited<ReturnType<typeof verifyAuth>>,
  action: string,
  target: string,
  targetId?: string | null,
  details?: string | null,
) {
  await prisma.adminAuditLog.create({
    data: {
      actorId: session.userId?.toString(),
      actorName: session.username,
      action,
      target,
      targetId,
      details,
    },
  });
}

/**
 * STAFF: RESOLVE DISPUTE
 */
export async function staffAdjudicateDisputeAction(formData: FormData) {
  const session = await requireStaffPermission("support");

  const orderId = formData.get("orderId")?.toString();
  const decision = formData.get("decision")?.toString();

  if (!orderId || !["REFUND_BUYER", "RELEASE_VENDOR"].includes(decision || "")) throw new Error("InvalidDecision");

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { product: true }
    });

    if (!order || order.status !== "DISPUTE") throw new Error("OrderNotInDispute");

    const winnerId = decision === "REFUND_BUYER" ? order.buyerId : order.vendorId;
    const amountToRelease = decision === "RELEASE_VENDOR" ? (money(order.totalXMR).minus(order.marketFeeXMR)) : order.totalXMR;
    const feeCollected = decision === "RELEASE_VENDOR" ? order.marketFeeXMR : 0;

    await tx.user.update({
      where: { id: winnerId },
      data: { walletBalanceXMR: { increment: amountToRelease } }
    });

    await tx.platformWallet.update({
      where: { id: "market_wallet" },
      data: {
        escrowTotal: { decrement: order.totalXMR },
      }
    });
    await creditPlatformRevenueFromEscrow({
      tx,
      amountXMR: feeCollected,
      orderId: order.id,
      buyerId: order.buyerId,
    });

    await tx.order.update({
      where: { id: orderId },
      data: { status: "COMPLETED" }
    });

    if (decision === "RELEASE_VENDOR") {
      const completedSales = await tx.order.count({
        where: { vendorId: order.vendorId, status: "COMPLETED" },
      });
      const vendorLevel = calculateVendorLevelFromSales(completedSales);
      await tx.user.update({
        where: { id: order.vendorId },
        data: {
          level: vendorLevel,
          badges: getBadgesForUser("VENDOR", vendorLevel).join(" ") || null,
          dispatchedOrdersCount: { increment: 1 },
        },
      });
    }

    await (tx as any).financialLog.create({
      data: {
        type: "ESCROW_RELEASE",
        amountXMR: amountToRelease,
        orderId: orderId,
        userId: winnerId,
        details: `Dispute adjudicated by Staff: ${decision}.`
      }
    });

    await tx.notification.createMany({
       data: [
          { userId: order.buyerId, type: "SYSTEM", title: "Dispute Resolved", content: `Order #${orderId.slice(0,6)}: Staff ruled for ${decision}.` },
          { userId: order.vendorId, type: "SYSTEM", title: "Dispute Resolved", content: `Order #${orderId.slice(0,6)}: Staff ruled for ${decision}.` }
       ]
    });

    await tx.adminAuditLog.create({
      data: {
        actorId: session.userId?.toString(),
        actorName: session.username,
        action: "DISPUTE_ADJUDICATED",
        target: "Order",
        targetId: orderId,
        details: decision,
      },
    });
  }).then(async () => {
    revalidatePath("/staff-vault");
  revalidatePath("/moderator");
    return redirect(await adminPath("orders", "success=DisputeResolved"));
  });
}

/**
 * STAFF: MANAGE PUBLIC MIRRORS (The "Floating Gateway" protocol)
 */
export async function manageMirrorsAction(formData: FormData) {
  const session = await requireStaffPermission("mirrors");

  const action = formData.get("action")?.toString(); // "ADD" or "DELETE"
  const url = formData.get("url")?.toString();
  const mirrorId = formData.get("mirrorId")?.toString();
  const isPrimary = formData.get("isPrimary") === "on";

  let normalizedMirror: string | null = null;
  if (action === "ADD" && url) {
    try {
      const parsed = new URL(url.includes("://") ? url : `http://${url}`);
      if (parsed.protocol !== "http:" || !parsed.hostname.endsWith(".onion") || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error("InvalidMirrorUrl");
      }
      normalizedMirror = parsed.toString().replace(/\/$/, "");
    } catch {
      return redirect(await adminPath("mirrors", "error=InvalidMirrorUrl"));
    }
    await (prisma as any).publicMirror.create({
      data: { url: normalizedMirror, isPrimary }
    });
    await writeAdminAudit(session, "MIRROR_ADDED", "PublicMirror", null, normalizedMirror);
  } else if (action === "DELETE" && mirrorId) {
    await (prisma as any).publicMirror.delete({
      where: { id: mirrorId }
    });
    await writeAdminAudit(session, "MIRROR_REMOVED", "PublicMirror", mirrorId);
  }

  revalidatePath("/market/mirrors");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("mirrors", "success=MirrorConfigUpdated"));
}

/**
 * STAFF: CREATE ANNOUNCEMENT (PGP SIGNED)
 */
export async function staffCreateAnnouncementAction(formData: FormData) {
  const session = await requireStaffPermission("broadcast");

  const title = formData.get("title")?.toString();
  const content = formData.get("content")?.toString();
  const signature = formData.get("signature")?.toString();
  const expiresInDays = Number(formData.get("expiresInDays")?.toString() || "0");
  const expiresAt = Number.isFinite(expiresInDays) && expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  if (!title || !content || !signature) throw new Error("MissingFields");

  const announcement = await prisma.announcement.create({
    data: { title, content, signature, expiresAt, isActive: true }
  });
  await writeAdminAudit(session, "ANNOUNCEMENT_CREATED", "Announcement", announcement.id, `${title} / expires=${expiresAt?.toISOString() || "never"}`);

  revalidatePath("/market");
  revalidatePath("/market/news");
  return redirect(await adminPath("broadcast", "success=AnnouncementPublished"));
}

export async function staffUpdateAnnouncementAction(formData: FormData) {
  const session = await requireStaffPermission("broadcast");

  const announcementId = formData.get("announcementId")?.toString();
  const title = formData.get("title")?.toString().trim();
  const content = formData.get("content")?.toString().trim();
  const signature = formData.get("signature")?.toString().trim();
  const expiresAtInput = formData.get("expiresAt")?.toString();
  const isActive = formData.get("isActive") === "on";
  const expiresAt = expiresAtInput ? new Date(expiresAtInput) : null;

  if (!announcementId || !title || !content || !signature || (expiresAtInput && Number.isNaN(expiresAt?.getTime()))) {
    return redirect(await adminPath("broadcast", "error=InvalidAnnouncement"));
  }

  const updated = await prisma.announcement.update({
    where: { id: announcementId },
    data: { title, content, signature, expiresAt, isActive },
  });

  await writeAdminAudit(session, "ANNOUNCEMENT_UPDATED", "Announcement", updated.id, `${title} / active=${isActive}`);

  revalidatePath("/market");
  revalidatePath("/market/news");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("broadcast", "success=AnnouncementUpdated"));
}

export async function staffDeleteAnnouncementAction(formData: FormData) {
  const session = await requireStaffPermission("broadcast");
  const announcementId = formData.get("announcementId")?.toString();

  if (!announcementId) return redirect(await adminPath("broadcast", "error=MissingAnnouncement"));

  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) return redirect(await adminPath("broadcast", "error=AnnouncementNotFound"));

  await prisma.announcement.update({
    where: { id: announcementId },
    data: { isActive: false, expiresAt: new Date() },
  });

  await writeAdminAudit(session, "ANNOUNCEMENT_EXPIRED", "Announcement", announcementId, announcement.title);

  revalidatePath("/market");
  revalidatePath("/market/news");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("broadcast", "success=AnnouncementExpired"));
}

/**
 * STAFF: BROADCAST NOTIFICATION
 */
export async function staffBroadcastNotificationAction(formData: FormData) {
  const session = await requireStaffPermission("broadcast");

  const title = formData.get("title")?.toString();
  const content = formData.get("content")?.toString();

  if (!title || !content) throw new Error("MissingFields");

  const users = await prisma.user.findMany({ select: { id: true } });

  // BATCHED BROADCAST (Frustrate memory spikes)
  const BATCH_SIZE = 500;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    await prisma.notification.createMany({
      data: batch.map(u => ({
        userId: u.id,
        type: "SYSTEM",
        title,
        content
      }))
    });
  }

  await writeAdminAudit(session, "BROADCAST_SENT", "Notification", null, `${title} / ${users.length} recipients`);

  return redirect(await adminPath("broadcast", "success=BroadcastComplete"));
}

/**
 * STAFF: TOGGLE MAINTENANCE MODE
 */
export async function staffToggleMaintenanceAction() {
  const session = await requireStaffPermission("system");

  const config = await (prisma as any).marketConfig.upsert({
    where: { id: "global_config" },
    update: {},
    create: { id: "global_config" }
  });

  const updated = await (prisma as any).marketConfig.update({
    where: { id: "global_config" },
    data: { isMaintenanceMode: !config.isMaintenanceMode }
  });
  await writeAdminAudit(session, "MAINTENANCE_TOGGLED", "MarketConfig", "global_config", `maintenance=${updated.isMaintenanceMode}`);

  revalidatePath("/");
  return redirect(await adminPath("system", "success=MaintenanceStateToggled"));
}

export async function staffUpsertFeatureFlagAction(formData: FormData) {
  const session = await requireStaffPermission("system");

  const key = formData.get("key")?.toString().trim();
  const description = formData.get("description")?.toString().trim() || null;
  const enabled = formData.get("enabled") === "on";

  if (!key || !/^[a-z0-9_.-]{3,80}$/i.test(key)) {
    return redirect(await adminPath("flags", "error=InvalidFeatureFlag"));
  }

  const flag = await prisma.featureFlag.upsert({
    where: { key },
    update: { enabled, description },
    create: { key, enabled, description },
  });

  await writeAdminAudit(session, "FEATURE_FLAG_UPDATED", "FeatureFlag", flag.key, `enabled=${flag.enabled}`);

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  revalidatePath("/market");
  return redirect(await adminPath("flags", "success=FeatureFlagUpdated"));
}

export async function staffCreateUserAction(formData: FormData) {
  const session = await requireStaffPermission("users");

  const username = normalizeUsername(formData.get("username")?.toString() || "");
  const password = formData.get("password")?.toString();
  const pin = formData.get("pin")?.toString();
  const role = formData.get("role")?.toString();
  const staffPermissions = formData.getAll("staffPermissions")
    .map((item) => item.toString())
    .filter((item): item is StaffPermission => MODERATOR_PERMISSIONS.some((permission) => permission === item));

  if (!isValidUsername(username) || !password || !isStrongPassword(password) || !isValidPinFormat(pin) || !["BUYER", "VENDOR", "STAFF", "ADMIN"].includes(role || "")) {
    return redirect(await adminPath("users", "error=InvalidUserInput"));
  }

  if (session.role !== "ADMIN" && ["ADMIN", "STAFF"].includes(role || "")) throw new Error("UnauthorizedRoleChange");
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return redirect(await adminPath("users", "error=UsernameTaken"));

  const salt = crypto.randomBytes(32).toString("hex");
  const created = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password, salt),
      passwordSalt: salt,
      pin: hashPin(pin),
      role: role as string,
      hasPaidBond: role === "VENDOR" || role === "ADMIN",
      staffPermissions: role === "STAFF" ? staffPermissions : [],
      walletBalanceXMR: 0,
      isPhraseViewed: true,
      antiPhishingPhrase: `${role} staff-created account`,
      trustScore: role === "ADMIN" ? 100 : role === "VENDOR" ? 80 : 0,
      level: role === "ADMIN" ? 10 : 1,
      staffId: role === "ADMIN" ? requiredProductionEnv("ADMIN_MSID", "STAFF-DEV-01") : undefined,
    },
  });
  await writeAdminAudit(session, "USER_CREATED", "User", created.id, `${role} ${staffPermissions.join(",")}`);

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("users", "success=UserCreated"));
}

export async function staffToggleUserBanAction(formData: FormData) {
  const userId = formData.get("userId")?.toString();
  if (!userId) return redirect(await adminPath("users", "error=MissingUser"));
  await staffToggleUserBan(userId);
  return redirect(await adminPath("users", "success=UserStatusUpdated"));
}

export async function staffSetUserRoleAction(formData: FormData) {
  const session = await requireStaffPermission("users");

  const userId = formData.get("userId")?.toString();
  const role = formData.get("role")?.toString();
  const staffPermissions = formData.getAll("staffPermissions")
    .map((item) => item.toString())
    .filter((item): item is StaffPermission => MODERATOR_PERMISSIONS.some((permission) => permission === item));
  if (!userId || !["BUYER", "VENDOR", "STAFF", "ADMIN"].includes(role || "")) {
    return redirect(await adminPath("users", "error=InvalidRole"));
  }

  const targetAccount = await prisma.user.findUnique({ where: { id: userId } });
  if (!targetAccount) throw new Error("UserNotFound");
  if (targetAccount.id === session.userId && role !== "ADMIN") throw new Error("CannotDemoteCurrentAccount");
  if (session.role !== "ADMIN" && (["ADMIN", "STAFF"].includes(role || "") || ["ADMIN", "STAFF"].includes(targetAccount.role))) {
    throw new Error("UnauthorizedRoleChange");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      role,
      sessionVersion: { increment: 1 },
      hasPaidBond: role === "VENDOR" || role === "ADMIN",
      staffId: role === "ADMIN" ? requiredProductionEnv("ADMIN_MSID", "STAFF-DEV-01") : null,
      staffPermissions: role === "STAFF" ? staffPermissions : [],
    },
  });
  await writeAdminAudit(session, "USER_ROLE_UPDATED", "User", userId, `${role} ${staffPermissions.join(",")}`);

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("users", "success=RoleUpdated"));
}

export async function staffAdjustWalletAction(formData: FormData) {
  const session = await requireStaffPermission("wallets");

  const userId = formData.get("userId")?.toString();
  const amount = parseMoney(formData.get("amountXMR")?.toString() || "0");
  const reason = formData.get("reason")?.toString().trim();

  if (!userId || amount.gte(0) || !reason || reason.length < 12) {
    return redirect(await adminPath("wallets", "error=InvalidWalletAdjustment"));
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { walletBalanceXMR: true },
    });

    if (!user || money(money(user.walletBalanceXMR).plus(amount)).lt(0)) {
      return "INVALID";
    }

    const debited = await tx.user.updateMany({
      where: { id: userId, walletBalanceXMR: { gte: amount.negated() } },
      data: { walletBalanceXMR: { increment: amount } },
    });
    if (debited.count !== 1) throw new Error("InsufficientBalance");
    await tx.financialLog.create({
      data: {
        type: "ADMIN_WALLET_DEBIT_CORRECTION",
        amountXMR: amount,
        userId,
        details: reason,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: session.userId?.toString(),
        actorName: session.username,
        action: "WALLET_DEBIT_CORRECTION",
        target: "User",
        targetId: userId,
        details: `${amount} XMR / ${reason}`,
      },
    });

    return "OK";
  });

  if (result !== "OK") {
    return redirect(await adminPath("wallets", "error=InvalidWalletCorrection"));
  }

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("wallets", "success=WalletCorrectionApplied"));
}

export async function staffCreateCategoryAction(formData: FormData) {
  const session = await requireStaffPermission("categories");

  const label = formData.get("label")?.toString().trim();
  const icon = formData.get("icon")?.toString().trim() || "[+]";
  const subcategories = formData.get("subcategories")?.toString()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) || [];

  if (!label || subcategories.length === 0) {
    return redirect(await adminPath("categories", "error=InvalidCategory"));
  }

  const category = await prisma.marketCategory.upsert({
    where: { label },
    update: { icon, subcategories, isActive: true },
    create: { label, icon, subcategories },
  });
  await writeAdminAudit(session, "CATEGORY_SAVED", "MarketCategory", category.id, label);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("categories", "success=CategorySaved"));
}

export async function staffUpdateCategoryAction(formData: FormData) {
  const session = await requireStaffPermission("categories");

  const categoryId = formData.get("categoryId")?.toString();
  const label = formData.get("label")?.toString().trim();
  const icon = formData.get("icon")?.toString().trim() || "[+]";
  const isActive = formData.get("isActive") === "on";
  const subcategories = formData.get("subcategories")?.toString()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) || [];

  if (!categoryId || !label || subcategories.length === 0) {
    return redirect(await adminPath("categories", "error=InvalidCategoryUpdate"));
  }

  const existing = await prisma.marketCategory.findUnique({ where: { id: categoryId } });
  if (!existing) return redirect(await adminPath("categories", "error=CategoryNotFound"));

  const category = await prisma.marketCategory.update({
    where: { id: categoryId },
    data: { label, icon, subcategories, isActive },
  });
  await writeAdminAudit(session, "CATEGORY_UPDATED", "MarketCategory", category.id, `${existing.label} -> ${label}`);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("categories", "success=CategoryUpdated"));
}

export async function staffDeleteCategoryAction(formData: FormData) {
  const session = await requireStaffPermission("categories");
  const categoryId = formData.get("categoryId")?.toString();

  if (!categoryId) return redirect(await adminPath("categories", "error=MissingCategory"));

  const category = await prisma.marketCategory.findUnique({ where: { id: categoryId } });
  if (!category) return redirect(await adminPath("categories", "error=CategoryNotFound"));

  const linkedProducts = await prisma.product.count({ where: { category: category.label } });

  if (linkedProducts > 0) {
    await prisma.marketCategory.update({
      where: { id: categoryId },
      data: { isActive: false },
    });
    await writeAdminAudit(session, "CATEGORY_DISABLED_WITH_PRODUCTS", "MarketCategory", categoryId, `${category.label} / ${linkedProducts} linked products`);
    revalidatePath("/market");
    revalidatePath("/staff-vault");
  revalidatePath("/moderator");
    return redirect(await adminPath("categories", "success=CategoryDisabled"));
  }

  await prisma.marketCategory.delete({ where: { id: categoryId } });
  await writeAdminAudit(session, "CATEGORY_DELETED", "MarketCategory", categoryId, category.label);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("categories", "success=CategoryDeleted"));
}

export async function staffDisableBuiltInCategoryAction(formData: FormData) {
  const session = await requireStaffPermission("categories");

  const label = formData.get("label")?.toString().trim();
  const icon = formData.get("icon")?.toString().trim() || "[+]";
  const subcategories = formData.get("subcategories")?.toString()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) || ["Other"];

  if (!label) return redirect(await adminPath("categories", "error=InvalidCategory"));

  const category = await prisma.marketCategory.upsert({
    where: { label },
    update: { icon, subcategories, isActive: false },
    create: { label, icon, subcategories, isActive: false },
  });

  await writeAdminAudit(session, "BUILT_IN_CATEGORY_DISABLED", "MarketCategory", category.id, label);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("categories", "success=CategoryDisabled"));
}

export async function staffToggleProductPauseAction(formData: FormData) {
  const session = await requireStaffPermission("products");

  const productId = formData.get("productId")?.toString();
  if (!productId) return redirect(await adminPath("products", "error=MissingProduct"));

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return redirect(await adminPath("products", "error=ProductNotFound"));

  await prisma.product.update({
    where: { id: productId },
    data: { isPaused: !product.isPaused },
  });
  await writeAdminAudit(session, product.isPaused ? "PRODUCT_RESUMED" : "PRODUCT_PAUSED", "Product", productId);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("products", "success=ProductModerated"));
}

export async function staffToggleProductPromotionAction(formData: FormData) {
  const session = await requireStaffPermission("products");

  const productId = formData.get("productId")?.toString();
  if (!productId) return redirect(await adminPath("products", "error=MissingProduct"));

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return redirect(await adminPath("products", "error=ProductNotFound"));

  await prisma.product.update({
    where: { id: productId },
    data: product.isPromoted
      ? { isPromoted: false, promotedUntil: null }
      : { isPromoted: true, promotedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  });
  await writeAdminAudit(session, product.isPromoted ? "PRODUCT_UNPROMOTED" : "PRODUCT_PROMOTED", "Product", productId);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("products", "success=PromotionUpdated"));
}

export async function staffSetTicketStatusAction(formData: FormData) {
  const session = await requireStaffPermission("support");

  const ticketId = formData.get("ticketId")?.toString();
  const status = formData.get("status")?.toString();
  if (!ticketId || !["OPEN", "STAFF_REPLY", "CLOSED"].includes(status || "")) {
    return redirect(await adminPath("support", "error=InvalidTicketStatus"));
  }

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status },
  });
  await writeAdminAudit(session, "TICKET_STATUS_UPDATED", "SupportTicket", ticketId, status);

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("support", "success=TicketUpdated"));
}

export async function staffReviewWithdrawalAction(formData: FormData) {
  const reqId = formData.get("withdrawalId")?.toString();
  const decision = formData.get("decision")?.toString();
  if (!reqId || (decision !== "APPROVE" && decision !== "REJECT")) {
    return redirect(await adminPath("wallets", "error=InvalidWithdrawalDecision"));
  }

  await staffManageWithdrawal(reqId, decision);
  return redirect(await adminPath("wallets", "success=WithdrawalUpdated"));
}


/**
 * EXISTING ACTIONS
 */
export async function staffToggleUserBan(userId: string) {
  const session = await requireStaffPermission("users");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.id === session.userId) throw new Error("CannotBanCurrentAccount");
  if (session.role !== "ADMIN" && ["ADMIN", "STAFF"].includes(user.role)) throw new Error("UnauthorizedStaffTarget");

  await prisma.user.update({
    where: { id: userId },
    data: { isBanned: !user.isBanned }
  });
  await writeAdminAudit(session, user.isBanned ? "USER_UNBANNED" : "USER_BANNED", "User", userId);

  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
}

export async function staffManageWithdrawal(reqId: string, decision: "APPROVE" | "REJECT") {
  const session = await requireStaffPermission("wallets");

  await reviewWithdrawal(prisma, { actorId: session.userId, requestId: reqId, decision }, transferWithReceipt);
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  revalidatePath("/market/wallet");
}

export async function staffReconcileWithdrawalAction(formData: FormData) {
  const session = await requireStaffPermission("wallets");
  await reconcileWithdrawal(prisma, {
    actorId: session.userId,
    requestId: formData.get("withdrawalId")?.toString() || "",
    txHash: formData.get("txHash")?.toString().trim() || "",
  }, verifyOutgoingTransfer);
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  revalidatePath("/market/wallet");
  return redirect(await adminPath("wallets", "success=WithdrawalReconciled"));
}

export async function staffModerateProductAction(formData: FormData) {
  const session = await requireStaffPermission("products");
  const productId = formData.get("productId")?.toString();
  const decision = formData.get("decision")?.toString();
  const note = formData.get("note")?.toString().trim() || null;

  if (!productId || !["APPROVED", "PENDING_REVIEW", "REJECTED"].includes(decision || "")) {
    return redirect(await adminPath("products", "error=InvalidModerationDecision"));
  }

  await prisma.$transaction([
    prisma.product.update({
      where: { id: productId },
      data: {
        moderationStatus: decision as string,
        moderationNote: note,
        moderatedAt: new Date(),
        moderatedById: session.userId?.toString(),
        isPaused: decision !== "APPROVED",
      },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorId: session.userId?.toString(),
        actorName: session.username,
        action: `PRODUCT_${decision}`,
        target: "Product",
        targetId: productId,
        details: note,
      },
    }),
  ]);

  revalidatePath("/market");
  revalidatePath("/staff-vault");
  revalidatePath("/moderator");
  return redirect(await adminPath("products", "success=ProductModerated"));
}
