import "server-only";
import { prisma } from "@/lib/db";
import { hasStaffPermission } from "@/lib/staff-permissions";

export async function canManageSupport(session: { userId: string; isStaffVerified?: unknown }) {
  if (!session.isStaffVerified) return false;
  const account = await prisma.user.findUnique({ where: { id: session.userId }, select: { role: true, isBanned: true, staffPermissions: true } });
  return hasStaffPermission(account, "support");
}
