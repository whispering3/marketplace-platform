import "server-only";

import { prisma } from "@/lib/db";
import { money } from "@/lib/money";
import { calculateVendorLevelFromSales, getBadgesForUser } from "@/lib/meritocracy";
import { creditPlatformRevenueFromEscrow } from "@/lib/platform-revenue";

async function completeExpiredOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId } });

    if (!order || order.status === "COMPLETED") return;
    if (order.status !== "SHIPPED") throw new Error("InvalidTransition");

    const vendorCut = money(order.totalXMR).minus(order.marketFeeXMR);
    await tx.order.update({ where: { id: order.id }, data: { status: "COMPLETED" } });
    const completedSales = await tx.order.count({ where: { vendorId: order.vendorId, status: "COMPLETED" } });
    const vendorLevel = calculateVendorLevelFromSales(completedSales);

    await tx.user.update({
      where: { id: order.vendorId },
      data: {
        walletBalanceXMR: { increment: vendorCut },
        xp: { increment: 25 },
        dispatchedOrdersCount: { increment: 1 },
        level: vendorLevel,
        badges: getBadgesForUser("VENDOR", vendorLevel).join(" ") || null,
      },
    });
    await tx.platformWallet.update({
      where: { id: "market_wallet" },
      data: { escrowTotal: { decrement: order.totalXMR } },
    });
    await creditPlatformRevenueFromEscrow({
      tx,
      amountXMR: order.marketFeeXMR,
      orderId: order.id,
      buyerId: order.buyerId,
    });
    await tx.notification.create({
      data: {
        userId: order.vendorId,
        type: "ORDER",
        title: "Order Status: COMPLETED",
        content: `Order #${order.id.slice(0, 6)} has been automatically completed.`,
      },
    });
    await tx.appEvent.create({
      data: {
        type: "order.completed",
        aggregate: "order",
        aggregateId: order.id,
        actorId: null,
        payload: { buyerId: order.buyerId, vendorId: order.vendorId, totalXMR: order.totalXMR },
      },
    });
  });
}

/** Server-only lazy lifecycle maintenance. This is deliberately not a Server Action. */
export async function checkOrderLifecycle() {
  const shippedBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const expiredOrders = await prisma.order.findMany({
    where: { status: "SHIPPED", shippedAt: { lt: shippedBefore } },
    select: { id: true },
  });

  for (const order of expiredOrders) await completeExpiredOrder(order.id);
}
