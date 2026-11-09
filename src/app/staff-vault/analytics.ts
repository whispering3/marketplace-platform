import { money } from "@/lib/money";
import type { Prisma } from "@prisma/client";
import type { AdminOrderRow, AdminProductRow, AdminTicketRow, AdminUserRow } from "./types";
export function buildWalletReconciliation(input: {
  platformWallet: Prisma.PlatformWalletGetPayload<Record<string, never>> | null;
  userWalletTotalXMR: number;
  pendingWithdrawalXMR: number;
  activeDepositWallets: number;
  processedDepositXMR: number;
}) {
  const platformBalanceXMR = input.platformWallet?.balanceXMR || 0;
  const escrowLiabilityXMR = input.platformWallet?.escrowTotal || 0;
  const availableTreasuryXMR = money(platformBalanceXMR).minus(escrowLiabilityXMR).minus(input.pendingWithdrawalXMR).minus(input.userWalletTotalXMR).toNumber();

  return {
    platformBalanceXMR,
    escrowLiabilityXMR,
    userWalletTotalXMR: input.userWalletTotalXMR,
    pendingWithdrawalXMR: input.pendingWithdrawalXMR,
    activeDepositWallets: input.activeDepositWallets,
    processedDepositXMR: input.processedDepositXMR,
    availableTreasuryXMR,
    platformSolvent: availableTreasuryXMR >= 0,
  };
}

export function getPeriodStart(period: string) {
  if (period === "all") return null;
  const hours = period === "24h" ? 24 : period === "30d" ? 24 * 30 : 24 * 7;
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

export function buildPeriodSnapshot(
  orders: AdminOrderRow[],
  logs: Prisma.FinancialLogGetPayload<Record<string, never>>[],
  adminLogs: Prisma.AdminAuditLogGetPayload<Record<string, never>>[],
  periodStart: Date | null,
) {
  const inPeriod = (date: Date) => !periodStart || date >= periodStart;
  const periodOrders = orders.filter((order) => inPeriod(order.createdAt));
  const periodFinancialLogs = logs.filter((log) => inPeriod(log.createdAt));
  const periodAdminLogs = adminLogs.filter((log) => inPeriod(log.createdAt));
  const gmvXMR = periodOrders.reduce((sum, order) => (sum + Number(order.totalXMR)), 0);
  const feesXMR = periodOrders.reduce((sum, order) => (sum + Number(order.marketFeeXMR)), 0);
  const escrowXMR = periodOrders
    .filter((order) => ["PENDING", "SHIPPED", "DISPUTE"].includes(order.status))
    .reduce((sum, order) => (sum + Number(order.totalXMR)), 0);

  const days = periodStart
    ? Math.max(1, Math.ceil((Date.now() - periodStart.getTime()) / 86400000))
    : 7;
  const bucketCount = Math.min(14, days);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const date = new Date(Date.now() - (bucketCount - 1 - index) * 86400000);
    const key = date.toISOString().slice(0, 10);
    return { key, label: date.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" }), orders: 0, height: 8 };
  });

  for (const order of periodOrders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.orders += 1;
  }

  const maxOrders = Math.max(1, ...buckets.map((bucket) => bucket.orders));
  for (const bucket of buckets) {
    bucket.height = Math.round((bucket.orders / maxOrders) * 100);
  }

  return {
    orders: periodOrders.length,
    gmvXMR,
    feesXMR,
    escrowXMR,
    financialEvents: periodFinancialLogs.length,
    operatorActions: periodAdminLogs.length,
    buckets,
  };
}

export function buildOverviewIntelligence(input: {
  users: AdminUserRow[];
  products: AdminProductRow[];
  orders: AdminOrderRow[];
  tickets: AdminTicketRow[];
  withdrawals: Prisma.WithdrawalRequestGetPayload<{ include: { user: { select: { username: true } } } }>[];
  logs: Prisma.FinancialLogGetPayload<Record<string, never>>[];
  mirrors: Prisma.PublicMirrorGetPayload<Record<string, never>>[];
  orderStatus: { status: string; _count: { _all: number } }[];
  ticketStatus: { status: string; _count: { _all: number } }[];
  platformWallet: Prisma.PlatformWalletGetPayload<Record<string, never>> | null;
  config: Prisma.MarketConfigGetPayload<Record<string, never>> | null;
  totalUsers: number;
  totalVendors: number;
  totalProducts: number;
  bannedUsers: number;
  promotedProducts: number;
  totalVolume: number;
  totalFees: number;
}) {
  const now = Date.now();
  const pendingWithdrawals = input.withdrawals.filter((withdrawal) => ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW"].includes(withdrawal.status));
  const openTickets = input.ticketStatus.find((row) => row.status === "OPEN")?._count._all || 0;
  const disputeOrders = input.orderStatus.find((row) => row.status === "DISPUTE")?._count._all || 0;
  const activeProducts = input.products.filter((product) => !product.isPaused && product.quantity > 0).length;
  const lowStockProducts = input.products.filter((product) => !product.isPaused && product.quantity > 0 && product.quantity <= 3);
  const pausedProducts = input.products.filter((product) => product.isPaused);
  const pendingModerationProducts = input.products.filter((product) => product.moderationStatus === "PENDING_REVIEW");
  const stuckOrders = input.orders.filter((order) => {
    if (!["PENDING", "SHIPPED"].includes(order.status)) return false;
    const ageHours = (now - order.createdAt.getTime()) / 36e5;
    return ageHours >= 72;
  });
  const staleTickets = input.tickets.filter((ticket) => {
    if (ticket.status === "CLOSED") return false;
    const ageHours = (now - ticket.updatedAt.getTime()) / 36e5;
    return ageHours >= 48;
  });
  const offlineMirrors = input.mirrors.filter((mirror) => mirror.status !== "ONLINE");
  const pendingWithdrawalXMR = pendingWithdrawals.reduce((sum, withdrawal) => ((sum + Number(withdrawal.amountXMR)) + Number(withdrawal.feeXMR)), 0);
  const financialExposureXMR = (Number((input.platformWallet?.escrowTotal || 0)) + pendingWithdrawalXMR);
  const promotedCoverage = activeProducts > 0
    ? Math.round((input.promotedProducts / activeProducts) * 100)
    : 0;

  const revenueByVendor = new Map<string, number>();
  for (const order of input.orders) {
    if (order.status !== "COMPLETED") continue;
    revenueByVendor.set(order.vendorId, (((revenueByVendor.get(order.vendorId) || 0) + Number(order.totalXMR)) - Number(order.marketFeeXMR)));
  }

  const topVendors = input.users
    .filter((user) => user.role === "VENDOR" || user.role === "ADMIN")
    .map((user) => ({
      id: user.id,
      username: user.username,
      trustScore: user.trustScore,
      orders: user._count.vendorOrders,
      products: user._count.products,
      revenueXMR: revenueByVendor.get(user.id) || 0,
    }))
    .sort((a, b) => b.revenueXMR - a.revenueXMR || b.orders - a.orders || b.trustScore - a.trustScore)
    .slice(0, 6);

  const riskItems = [
    { label: "Open tickets", value: openTickets, description: "Support queue needing staff attention", href: "?tab=support&status=OPEN", tone: "red" as const },
    { label: "Disputes", value: disputeOrders, description: "Escrow conflicts waiting adjudication", href: "?tab=orders&status=DISPUTE", tone: "red" as const },
    { label: "Pending withdrawals", value: pendingWithdrawals.length, description: `${pendingWithdrawalXMR.toFixed(5)} XMR awaiting review`, href: "?tab=wallets&status=AWAITING_APPROVAL", tone: "amber" as const },
    { label: "Product review", value: pendingModerationProducts.length, description: "Catalog listings waiting approval", href: "?tab=products&status=PENDING_REVIEW", tone: "amber" as const },
    { label: "Stuck orders", value: stuckOrders.length, description: "Pending or shipped for more than 72h", href: "?tab=orders", tone: "amber" as const },
    { label: "Stale support", value: staleTickets.length, description: "Open tickets not updated for 48h", href: "?tab=support", tone: "amber" as const },
    { label: "Low stock", value: lowStockProducts.length, description: "Active listings with 3 units or less", href: "?tab=products&status=ACTIVE", tone: "neutral" as const },
    { label: "Paused products", value: pausedProducts.length, description: "Catalog entries currently hidden", href: "?tab=products&status=PAUSED", tone: "neutral" as const },
  ].filter((item) => item.value > 0);

  const commandState = input.config?.isMaintenanceMode
    ? { label: "Maintenance Mode", tone: "red" as const, summary: "New high-risk operations should remain paused until cleared." }
    : openTickets + disputeOrders + pendingWithdrawals.length + stuckOrders.length + pendingModerationProducts.length > 0
      ? { label: "Attention Required", tone: "amber" as const, summary: "Operational queues are active and should be reviewed." }
      : { label: "Operational", tone: "green" as const, summary: "No urgent queue detected from the current dataset." };

  const health = [
    {
      label: "Marketplace",
      status: input.config?.isMaintenanceMode ? "Limited" : "Online",
      tone: input.config?.isMaintenanceMode ? "amber" as const : "green" as const,
      detail: input.config?.isMaintenanceMode ? "Maintenance mode is active." : "Checkout surface is available.",
    },
    {
      label: "Escrow Wallet",
      status: financialExposureXMR > 0 ? "Exposed" : "Clear",
      tone: financialExposureXMR > 0 ? "amber" as const : "green" as const,
      detail: `${financialExposureXMR.toFixed(5)} XMR under operational custody.`,
    },
    {
      label: "Support SLA",
      status: staleTickets.length > 0 ? "Aging" : "Current",
      tone: staleTickets.length > 0 ? "amber" as const : "green" as const,
      detail: `${staleTickets.length} tickets older than 48h.`,
    },
    {
      label: "Gateway Mirrors",
      status: offlineMirrors.length > 0 ? "Degraded" : "Online",
      tone: offlineMirrors.length > 0 ? "red" as const : "green" as const,
      detail: `${input.mirrors.length - offlineMirrors.length}/${input.mirrors.length || 0} mirrors online.`,
    },
    {
      label: "Revenue",
      status: input.totalFees > 0 ? "Earning" : "No Fees",
      tone: input.totalFees > 0 ? "green" as const : "neutral" as const,
      detail: `${input.totalFees.toFixed(5)} XMR fees from ${input.totalVolume.toFixed(5)} XMR GMV.`,
    },
    {
      label: "User Risk",
      status: input.bannedUsers > 0 ? "Flagged" : "Clean",
      tone: input.bannedUsers > 0 ? "amber" as const : "green" as const,
      detail: `${input.bannedUsers} banned of ${input.totalUsers} users.`,
    },
  ];

  return {
    commandState,
    financialExposureXMR,
    promotedCoverage,
    riskItems,
    health,
    topVendors,
    totalVendors: input.totalVendors,
    totalProducts: input.totalProducts,
  };
}
