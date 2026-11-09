import { prisma } from "./db";

export async function createNotification(userId: string, title: string, content: string, type: "ORDER" | "MESSAGE" | "SUPPORT" | "SYSTEM") {
  try {
    await prisma.notification.create({
      data: {
        userId,
        title,
        content,
        type
      }
    });
  } catch (error) {
    console.error("Failed to create notification:", error);
  }
}

export async function getUnreadCount(userId: string) {
  return await prisma.notification.count({
    where: { userId, isRead: false }
  });
}
