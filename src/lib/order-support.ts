import "server-only";

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";
import { requirePgpArmoredMessage } from "@/lib/zero-knowledge";

export type OrderSupportResult = {
  redirectTo: string;
};

export async function openOrderSupportTicketForSession(
  session: SessionPayload,
  formData: FormData
): Promise<OrderSupportResult> {
  const orderId = formData.get("orderId")?.toString();
  const content = formData.get("content")?.toString();
  const priority = formData.get("priority")?.toString() || "HIGH";

  if (!orderId || orderId.length > 64 || !content || content.length > 65_536 || !["NORMAL", "HIGH"].includes(priority)) {
    return { redirectTo: "/market/support?error=MissingOrderTicketData" };
  }

  let encryptedContent: string;
  try {
    encryptedContent = requirePgpArmoredMessage(content, "OrderSupportMessage");
  } catch {
    return { redirectTo: "/market/support?error=SupportMessageMustBePgpEncrypted" };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      product: { select: { title: true } },
      supportTicket: { select: { id: true } },
      disputeTicket: { select: { id: true } },
    },
  });

  if (!order) {
    return { redirectTo: "/market/support?error=OrderNotFound" };
  }

  const isBuyer = order.buyerId === session.userId;
  const isVendor = order.vendorId === session.userId;
  const isAdmin = session.role === "ADMIN";

  if (!isBuyer && !isVendor && !isAdmin) {
    return { redirectTo: "/market/support?error=UnauthorizedOrderTicket" };
  }

  const existingTicketId = order.supportTicket?.id || order.disputeTicket?.id;
  if (existingTicketId) {
    await prisma.ticketMessage.create({
      data: {
        ticketId: existingTicketId,
        senderRole: isAdmin ? "STAFF" : isVendor ? "VENDOR" : "BUYER",
        senderId: session.userId,
        pgpContent: encryptedContent,
      },
    });
    await prisma.supportTicket.update({
      where: { id: existingTicketId },
      data: {
        status: isAdmin ? "STAFF_REPLY" : "OPEN",
        updatedAt: new Date(),
      },
    });
    return { redirectTo: `/market/support/${existingTicketId}?success=MessageAdded` };
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        userId: session.userId,
        orderId: order.id,
        buyerId: order.buyerId,
        vendorId: order.vendorId,
        subject: `Order ${order.id.slice(0, 8)} - ${order.product.title}`,
        category: "ORDER_DISPUTE",
        priority,
        status: "OPEN",
        messages: {
          create: {
            senderRole: isAdmin ? "STAFF" : isVendor ? "VENDOR" : "BUYER",
            senderId: session.userId,
            pgpContent: encryptedContent,
          },
        },
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: order.status === "COMPLETED" ? order.status : "DISPUTE",
        disputeTicketId: created.id,
      },
    });

    return created;
  });

  return { redirectTo: `/market/support/${ticket.id}?success=OrderTicketCreated` };
}
