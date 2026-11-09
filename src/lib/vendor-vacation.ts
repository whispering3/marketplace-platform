import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type OrderReader = Pick<Prisma.TransactionClient, "order">;

export type VendorVacationBlockers = {
  openOrders: number;
  openDisputes: number;
  total: number;
};

export async function getVendorVacationBlockers(
  vendorId: string,
  client: OrderReader = prisma,
): Promise<VendorVacationBlockers> {
  const orders = await client.order.findMany({
    where: {
      vendorId,
      OR: [
        { status: { not: "COMPLETED" } },
        { disputeTicket: { is: { status: { not: "CLOSED" } } } },
        { supportTicket: { is: { category: "ORDER_DISPUTE", status: { not: "CLOSED" } } } },
      ],
    },
    select: {
      status: true,
      disputeTicket: { select: { status: true } },
      supportTicket: { select: { category: true, status: true } },
    },
  });

  let openOrders = 0;
  let openDisputes = 0;
  for (const order of orders) {
    const hasOpenDispute = order.status === "DISPUTE"
      || (order.disputeTicket !== null && order.disputeTicket.status !== "CLOSED")
      || (order.supportTicket?.category === "ORDER_DISPUTE" && order.supportTicket.status !== "CLOSED");
    if (hasOpenDispute) openDisputes += 1;
    else if (order.status !== "COMPLETED") openOrders += 1;
  }

  return { openOrders, openDisputes, total: openOrders + openDisputes };
}
