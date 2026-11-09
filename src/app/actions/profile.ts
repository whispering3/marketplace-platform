"use server";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { verifyPin } from "@/lib/pin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getVendorVacationBlockers } from "@/lib/vendor-vacation";
import { validatePgpEncryptionPublicKey } from "@/lib/pgp-key";
import { recordSecurityEvent } from "@/lib/security-events";

export async function updateProfileAction(formData: FormData) {
  const session = await verifyAuth();

  const pgpPublicKey = formData.get("user_pgp")?.toString();
  const vendorTerms = formData.get("vendor_terms")?.toString();
  const vacationMode = formData.get("vacation_mode") === "on";
  const pin = formData.get("pin")?.toString();

  // 1. Verify user exists and check PIN
  const user = await prisma.user.findUnique({
    where: { id: session.userId as string }
  });

  if (!user || user.isBanned) return redirect("/auth/login");

  // Strict PIN check for security changes
  if (!verifyPin(pin, user.pin)) {
    return redirect("/market/profile?error=InvalidPIN");
  }

  if (!pgpPublicKey || !await validatePgpEncryptionPublicKey(pgpPublicKey)) {
    return redirect("/market/profile?error=InvalidPGPEncryptionKey");
  }
  if (vacationMode && !user.isVacationMode && (user.role === "VENDOR" || user.role === "ADMIN")) {
    const blockers = await getVendorVacationBlockers(user.id);
    if (blockers.total > 0) {
      return redirect(`/market/profile?error=VacationBlocked&openOrders=${blockers.openOrders}&openDisputes=${blockers.openDisputes}`);
    }
  }
  // 2. Update basic fields
  const data: {
    pgpPublicKey: string | null;
    suicidePin: null;
    isVacationMode: boolean;
    vendorTerms?: string | null;
  } = {
    pgpPublicKey,
    suicidePin: null,
    isVacationMode: vacationMode
  };

  // Only allow updating terms if they are a vendor
  if (user.role === "VENDOR" || user.role === "ADMIN") {
    data.vendorTerms = vendorTerms || null;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { ...data, sessionVersion: pgpPublicKey !== user.pgpPublicKey ? { increment: 1 } : undefined }
  });

  if (pgpPublicKey !== user.pgpPublicKey) { const { deleteSession } = await import("@/lib/session"); return deleteSession(); }
  revalidatePath("/market/profile");
  return redirect("/market/profile?success=IdentityUpdated");
}

export async function revokeOtherSessionsAction(formData: FormData) {
  const session = await verifyAuth();
  const pin = formData.get("pin")?.toString();
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { pin: true, isBanned: true } });
  if (!user || user.isBanned) return redirect("/auth/login");
  if (!verifyPin(pin, user.pin)) return redirect("/market/profile?error=InvalidSessionPIN");

  const result = await prisma.authSession.updateMany({
    where: { userId: session.userId, id: { not: session.sessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordSecurityEvent({
    category: "SESSION_REVOCATION",
    outcome: "SUCCESS",
    userId: session.userId,
    details: `revoked=${result.count}`,
  });
  revalidatePath("/market/profile");
  return redirect("/market/profile?success=OtherSessionsRevoked");
}
