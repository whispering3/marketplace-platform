"use server";

import { canManageSupport } from "@/lib/support-access";
import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePgpArmoredMessage } from "@/lib/zero-knowledge";
import { openOrderSupportTicketForSession } from "@/lib/order-support";

export async function createSupportTicketAction(formData: FormData) {
  const session = await verifyAuth();
  const subject = formData.get("subject")?.toString();
  const category = formData.get("category")?.toString() || "OTHER";
  const priority = formData.get("priority")?.toString() || "NORMAL";
  const content = formData.get("content")?.toString();

  if (!subject || subject.length > 160 || !content || content.length > 65_536 || !["TECHNICAL", "FINANCIAL", "DISPUTE", "OTHER"].includes(category) || !["NORMAL", "HIGH", "URGENT"].includes(priority)) {
    return redirect("/market/support?error=MissingFields");
  }

  let encryptedContent: string;
  try {
    encryptedContent = requirePgpArmoredMessage(content, "SupportMessage");
  } catch {
    return redirect("/market/support?error=SupportMessageMustBePgpEncrypted");
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: session.userId as string,
      subject,
      category,
      priority,
      messages: {
        create: {
          senderRole: "USER",
          senderId: session.userId as string,
          pgpContent: encryptedContent
        }
      }
    }
  });

  revalidatePath("/market/support");
  return redirect(`/market/support/${ticket.id}?success=TicketCreated`);
}

export async function openOrderSupportTicketAction(formData: FormData) {
  const session = await verifyAuth();
  const result = await openOrderSupportTicketForSession(session, formData);
  revalidatePath("/market/support");
  revalidatePath("/market/dashboard/buyer");
  revalidatePath("/market/dashboard/vendor");
  return redirect(result.redirectTo);
}

export async function replyToTicketAction(formData: FormData) {
  const session = await verifyAuth();
  const ticketId = formData.get("ticketId")?.toString();
  const content = formData.get("content")?.toString();
  const isAdmin = await canManageSupport(session);

  if (!ticketId || !content) return redirect("/market/support?error=MissingData");
  let encryptedContent: string;
  try {
    encryptedContent = requirePgpArmoredMessage(content, "SupportMessage");
  } catch {
    return redirect(`/market/support/${ticketId}?error=SupportMessageMustBePgpEncrypted`);
  }

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, buyerId: true, vendorId: true },
  });

  if (!ticket) return redirect("/market/support?error=NotFound");
  const isParticipant = ticket.userId === session.userId || ticket.buyerId === session.userId || ticket.vendorId === session.userId;
  if (!isAdmin && !isParticipant) return redirect("/market/support?error=Unauthorized");

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      status: isAdmin ? "STAFF_REPLY" : "OPEN",
      messages: {
        create: {
          senderRole: isAdmin ? "STAFF" : ticket.vendorId === session.userId ? "VENDOR" : "BUYER",
          senderId: session.userId as string,
          pgpContent: encryptedContent
        }
      }
    }
  });

  revalidatePath(`/market/support/${ticketId}`);
  return redirect(`/market/support/${ticketId}?success=ReplySent`);
}

export async function closeTicketAction(formData: FormData) {
  const session = await verifyAuth();
  const ticketId = formData.get("ticketId")?.toString();

  if (!ticketId) return;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true, buyerId: true, vendorId: true },
  });
  if (!ticket) return;

  const isParticipant = ticket.userId === session.userId || ticket.buyerId === session.userId || ticket.vendorId === session.userId;
  if (!await canManageSupport(session) && !isParticipant) return;

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: "CLOSED" }
  });

  revalidatePath("/market/support");
  return redirect("/market/support?success=TicketClosed");
}
