
import { localRedirect } from "@/lib/local-redirect";
import { prisma } from "@/lib/db";
import { requiredProductionEnv } from "@/lib/env";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { rejectUnsafeMutation } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function adminBroadcastPath(status: string) {
  const base = `/${requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev")}`;
  return `${base}?tab=broadcast&${status}`;
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  const session = await verifyAuth();
  const adminPath = adminBroadcastPath("success=AnnouncementExpired");

  if (session.role !== "ADMIN" || !session.isStaffVerified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const announcementId = formData.get("announcementId")?.toString();
  if (!announcementId) {
    return localRedirect(adminBroadcastPath("error=MissingAnnouncement"));
  }

  const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
  if (!announcement) {
    return localRedirect(adminBroadcastPath("error=AnnouncementNotFound"));
  }

  await prisma.$transaction([
    prisma.announcement.update({
      where: { id: announcementId },
      data: { isActive: false, expiresAt: new Date() },
    }),
    prisma.adminAuditLog.create({
      data: {
        actorId: session.userId?.toString(),
        actorName: session.username,
        action: "ANNOUNCEMENT_EXPIRED",
        target: "Announcement",
        targetId: announcementId,
        details: announcement.title,
      },
    }),
  ]);

  revalidatePath("/market");
  revalidatePath("/market/news");
  revalidatePath("/staff-vault");
  return localRedirect(adminPath);
}
