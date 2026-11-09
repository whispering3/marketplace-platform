"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { createNotification } from "@/lib/alerts";
import { revalidatePath } from "next/cache";

export async function sendMessageAction(formData: FormData) {
  const session = await verifyAuth();

  const receiverUsername = formData.get("receiver")?.toString()?.trim();
  const payload = formData.get("payload")?.toString()?.trim();

  if (!receiverUsername || !payload || receiverUsername.length > 32 || payload.length > 65_536) {
    return redirect("/market/inbox?error=MissingFields");
  }

  // 1. Rate Limiting: Max 5 messages per 60 seconds
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const recentMsgsCount = await prisma.inboxMessage.count({
    where: { senderId: session.userId, createdAt: { gte: oneMinuteAgo } }
  });

  if (recentMsgsCount >= 5) {
     return redirect("/market/inbox?error=RateLimitExceeded_Wait60s");
  }

  // Validate PGP format
  if (!payload.startsWith("-----BEGIN PGP MESSAGE-----") || !payload.endsWith("-----END PGP MESSAGE-----")) {
    return redirect("/market/inbox?error=NotPGP");
  }

  // Look up receiver
  const receiver = await prisma.user.findUnique({
    where: { username: receiverUsername }
  });

  if (!receiver) {
    return redirect("/market/inbox?error=ReceiverNotFound");
  }

  if (receiver.id === session.userId) {
     return redirect("/market/inbox?error=SelfMessage");
  }

  // Define Participant IDs sorting (Smallest first to keep unique pairing)
  const partA = session.userId < receiver.id ? session.userId : receiver.id;
  const partB = session.userId < receiver.id ? receiver.id : session.userId;

  // Find or Create Conversation
  const conversation = await prisma.conversation.upsert({
    where: {
      participantAId_participantBId: {
        participantAId: partA,
        participantBId: partB
      }
    },
    update: { updatedAt: new Date() },
    create: {
      participantAId: partA,
      participantBId: partB
    }
  });

  await prisma.inboxMessage.create({
    data: {
      senderId: session.userId,
      receiverId: receiver.id,
      conversationId: conversation.id,
      pgpMessage: payload,
    }
  });

  // Notify Receiver
  await createNotification(
    receiver.id,
    "New Cipher Transmission",
    `Encrypted message from ${session.username}`,
    "MESSAGE"
  );

  return redirect(`/market/inbox/${conversation.id}?success=Sent`);
}

export async function markNotificationsReadAction() {
  const session = await verifyAuth();

  await prisma.notification.updateMany({
    where: {
      userId: session.userId as string,
      isRead: false,
      type: { not: "MESSAGE" },
    },
    data: { isRead: true },
  });

  revalidatePath("/market/inbox");
  revalidatePath("/market");
  return redirect("/market/inbox?success=NotificationsRead");
}

export async function deleteNotificationAction(formData: FormData) {
  const session = await verifyAuth();
  const notificationId = formData.get("notificationId")?.toString().trim();

  if (!notificationId || notificationId.length > 64) {
    return redirect("/market/inbox?error=InvalidNotification");
  }

  await prisma.notification.deleteMany({
    where: {
      id: notificationId,
      userId: session.userId as string,
      type: { not: "MESSAGE" },
    },
  });

  revalidatePath("/market/inbox");
  revalidatePath("/market");
  return redirect("/market/inbox?success=NotificationDeleted");
}

export async function deleteAllNotificationsAction() {
  const session = await verifyAuth();

  await prisma.notification.deleteMany({
    where: {
      userId: session.userId as string,
      type: { not: "MESSAGE" },
    },
  });

  revalidatePath("/market/inbox");
  revalidatePath("/market");
  return redirect("/market/inbox?success=NotificationsDeleted");
}
