import "server-only";

import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseUtcDate(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveVendorOperationsPeriod(from?: string, to?: string) {
  const now = new Date();
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const defaultFrom = new Date(defaultTo.getTime() - 29 * DAY_MS);
  const parsedFrom = parseUtcDate(from) || defaultFrom;
  const parsedTo = parseUtcDate(to, true) || defaultTo;
  const start = parsedFrom <= parsedTo ? parsedFrom : parsedTo;
  const end = parsedFrom <= parsedTo ? parsedTo : parsedFrom;
  return {
    start,
    end,
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export async function getVendorOperations(vendorId: string, from?: string, to?: string) {
  const period = resolveVendorOperationsPeriod(from, to);
  const createdAt = { gte: period.start, lte: period.end };
  const processedAt = { gte: period.start, lte: period.end };

  const [
    completedSales,
    ordersByStatus,
    listingsCreated,
    totalListings,
    activeListings,
    disputesOpened,
    completedWithdrawals,
    requestedWithdrawals,
    pendingWithdrawals,
    whitelistAdded,
    whitelistTotal,
    recentSales,
    recentWithdrawals,
    whitelistEntries,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { vendorId, status: "COMPLETED", createdAt },
      _count: { _all: true },
      _sum: { totalXMR: true, marketFeeXMR: true },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { vendorId, createdAt },
      _count: { _all: true },
    }),
    prisma.product.count({ where: { vendorId, createdAt } }),
    prisma.product.count({ where: { vendorId } }),
    prisma.product.count({ where: { vendorId, moderationStatus: "APPROVED", isPaused: false, quantity: { gt: 0 } } }),
    prisma.supportTicket.count({ where: { vendorId, category: "ORDER_DISPUTE", createdAt } }),
    prisma.withdrawalRequest.aggregate({
      where: { userId: vendorId, status: "COMPLETED", processedAt },
      _count: { _all: true },
      _sum: { amountXMR: true },
    }),
    prisma.withdrawalRequest.aggregate({
      where: { userId: vendorId, createdAt },
      _count: { _all: true },
      _sum: { amountXMR: true },
    }),
    prisma.withdrawalRequest.aggregate({
      where: { userId: vendorId, status: { in: ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW"] } },
      _count: { _all: true },
      _sum: { amountXMR: true },
    }),
    prisma.vendorWhitelistEntry.count({ where: { vendorId, createdAt } }),
    prisma.vendorWhitelistEntry.count({ where: { vendorId } }),
    prisma.order.findMany({
      where: { vendorId, status: "COMPLETED", createdAt },
      select: { id: true, createdAt: true, totalXMR: true, marketFeeXMR: true, product: { select: { title: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
    }),
    prisma.withdrawalRequest.findMany({
      where: { userId: vendorId, createdAt },
      select: { id: true, createdAt: true, processedAt: true, amountXMR: true, status: true, txHash: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
    }),
    prisma.vendorWhitelistEntry.findMany({
      where: { vendorId },
      select: { id: true, createdAt: true, buyer: { select: { username: true, trustScore: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
    }),
  ]);

  const grossSalesXMR = Number(completedSales._sum.totalXMR || 0);
  const feesXMR = Number(completedSales._sum.marketFeeXMR || 0);
  const orderCount = ordersByStatus.reduce((sum, row) => sum + row._count._all, 0);
  const statusCounts = Object.fromEntries(ordersByStatus.map((row) => [row.status, row._count._all]));

  return {
    period,
    metrics: {
      grossSalesXMR,
      netSalesXMR: grossSalesXMR - feesXMR,
      completedSales: completedSales._count._all,
      averageOrderXMR: completedSales._count._all ? grossSalesXMR / completedSales._count._all : 0,
      orders: orderCount,
      openOrders: Object.entries(statusCounts).filter(([status]) => status !== "COMPLETED").reduce((sum, [, count]) => sum + count, 0),
      disputesOpened,
      disputeRate: orderCount ? (disputesOpened / orderCount) * 100 : 0,
      listingsCreated,
      totalListings,
      activeListings,
      withdrawnXMR: Number(completedWithdrawals._sum.amountXMR || 0),
      completedWithdrawals: completedWithdrawals._count._all,
      requestedWithdrawalXMR: Number(requestedWithdrawals._sum.amountXMR || 0),
      withdrawalRequests: requestedWithdrawals._count._all,
      pendingWithdrawalXMR: Number(pendingWithdrawals._sum.amountXMR || 0),
      pendingWithdrawals: pendingWithdrawals._count._all,
      whitelistAdded,
      whitelistTotal,
    },
    statusCounts,
    recentSales,
    recentWithdrawals,
    whitelistEntries,
  };
}
