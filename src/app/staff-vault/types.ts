import type { Prisma } from "@prisma/client";
export type AdminUserRow = Prisma.UserGetPayload<{
  include: { _count: { select: { products: true; orders: true; vendorOrders: true; supportTickets: true } } };
}>;

export type AdminProductRow = Prisma.ProductGetPayload<{
  include: { vendor: { select: { username: true; isBanned: true } }; _count: { select: { orders: true; reviews: true } } };
}>;

export type AdminOrderRow = Prisma.OrderGetPayload<{
  include: {
    buyer: { select: { username: true } };
    vendor: { select: { username: true } };
    product: { select: { title: true; productType: true } };
  };
}>;

export type AdminTicketRow = Prisma.SupportTicketGetPayload<{
  include: {
    user: { select: { username: true } };
    buyer: { select: { username: true } };
    vendor: { select: { username: true } };
    order: { select: { id: true; status: true } };
  };
}>;
