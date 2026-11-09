import { prisma } from "@/lib/db";
import "server-only";
export async function getBuyerDetail(buyerId: string) {
  const [buyer, orders, reviews, tickets, favorites, logs, withdrawals] = await Promise.all([
    prisma.user.findUnique({
      where: { id: buyerId },
      include: {
        _count: {
          select: {
            orders: true,
            reviews: true,
            buyerSupportTickets: true,
            favorites: true,
            withdrawals: true,
          },
        },
      },
    }),
    prisma.order.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        vendor: { select: { username: true } },
        product: { select: { title: true, productType: true } },
      },
    }),
    prisma.review.findMany({
      where: { buyerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { product: { select: { title: true } } },
    }),
    prisma.supportTicket.findMany({
      where: { buyerId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        vendor: { select: { username: true } },
        order: { select: { id: true, status: true } },
      },
    }),
    prisma.favorite.findMany({
      where: { userId: buyerId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { product: { select: { title: true, priceXMR: true, category: true, vendor: { select: { username: true } } } } },
    }),
    prisma.financialLog.findMany({
      where: { userId: buyerId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.withdrawalRequest.findMany({
      where: { userId: buyerId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  if (!buyer) return null;

  const completedOrders = orders.filter((order) => order.status === "COMPLETED");
  const escrowOrders = orders.filter((order) => ["PENDING", "SHIPPED", "DISPUTE"].includes(order.status));

  return {
    buyer,
    orders,
    reviews,
    tickets,
    favorites,
    logs,
    withdrawals,
    stats: {
      totalSpentXMR: completedOrders.reduce((sum, order) => (sum + Number(order.totalXMR)), 0),
      escrowXMR: escrowOrders.reduce((sum, order) => (sum + Number(order.totalXMR)), 0),
      disputes: orders.filter((order) => order.status === "DISPUTE").length,
      completed: completedOrders.length,
    },
  };
}

export async function getOrderDetail(orderId: string) {
  const [order, messages, logs] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: { select: { id: true, username: true, role: true, isBanned: true } },
        vendor: { select: { id: true, username: true, role: true, isBanned: true, trustScore: true, level: true } },
        product: { select: { id: true, title: true, productType: true, category: true, subcategory: true, priceXMR: true, isPaused: true, moderationStatus: true } },
        supportTicket: { include: { messages: { orderBy: { createdAt: "asc" } } } },
        disputeTicket: { include: { messages: { orderBy: { createdAt: "asc" } } } },
      },
    }),
    prisma.orderChat.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      include: { sender: { select: { username: true, role: true } } },
    }),
    prisma.financialLog.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!order) return null;

  return { order, messages, logs };
}

export async function getVendorDetail(vendorId: string) {
  const [vendor, products, orders, reviews, withdrawals, tickets, logs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: vendorId },
      include: {
        _count: {
          select: {
            products: true,
            vendorOrders: true,
            vendorSupportTickets: true,
            withdrawals: true,
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { vendorId },
      orderBy: [{ isPromoted: "desc" }, { createdAt: "desc" }],
      take: 30,
      include: { _count: { select: { orders: true, reviews: true } } },
    }),
    prisma.order.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        buyer: { select: { username: true } },
        product: { select: { title: true, productType: true } },
      },
    }),
    prisma.review.findMany({
      where: { product: { vendorId } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        buyer: { select: { username: true } },
        product: { select: { title: true } },
      },
    }),
    prisma.withdrawalRequest.findMany({
      where: { userId: vendorId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.supportTicket.findMany({
      where: { vendorId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        buyer: { select: { username: true } },
        order: { select: { id: true, status: true } },
      },
    }),
    prisma.financialLog.findMany({
      where: { userId: vendorId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  if (!vendor) return null;

  const completedOrders = orders.filter((order) => order.status === "COMPLETED");
  const escrowOrders = orders.filter((order) => ["PENDING", "SHIPPED", "DISPUTE"].includes(order.status));
  const grossSalesXMR = completedOrders.reduce((sum, order) => (sum + Number(order.totalXMR)), 0);
  const netSalesXMR = completedOrders.reduce((sum, order) => ((sum + Number(order.totalXMR)) - Number(order.marketFeeXMR)), 0);
  const escrowXMR = escrowOrders.reduce((sum, order) => ((sum + Number(order.totalXMR)) - Number(order.marketFeeXMR)), 0);
  const avgRating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  return {
    vendor,
    products,
    orders,
    reviews,
    withdrawals,
    tickets,
    logs,
    stats: {
      grossSalesXMR,
      netSalesXMR,
      escrowXMR,
      avgRating,
      completedSales: completedOrders.length,
      promotedProducts: products.filter((product) => product.isPromoted).length,
      activeProducts: products.filter((product) => !product.isPaused && product.quantity > 0).length,
    },
  };
}
