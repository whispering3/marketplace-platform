"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { upgradeStaffSessionToken, verifyAuth } from "@/lib/session";
import * as openpgp from "openpgp";
import { redirect } from "next/navigation";
import { issueAuthChallenge, consumeAuthChallenge } from "@/lib/auth-challenges";
import { assertAuthNotLocked, recordAuthFailure, clearAuthFailures, constantTimeStringEquals } from "@/lib/auth-hardening";
import { verifyPin } from "@/lib/pin";
import { requiredProductionEnv } from "@/lib/env";
import { recordSecurityEvent } from "@/lib/security-events";

/**
 * GENERATE CHALLENGE
 * Creates a unique string for the admin to sign with their PGP key.
 */
export async function getStaffChallenge() {
  const session = await verifyAuth();
  if (session.role !== "ADMIN" && session.role !== "STAFF") throw new Error("Unauthorized");

  return issueAuthChallenge(prisma, session.userId as string, "STAFF");
}

/**
 * VERIFY STAFF SIGNATURE (PGP + MSID + PIN)
 */
export async function verifyStaffAction(formData: FormData) {
  const sessionData = await verifyAuth();
  if (sessionData.role !== "ADMIN" && sessionData.role !== "STAFF") return redirect("/market");

  const msidInput = formData.get("msid")?.toString();
  const pinInput = formData.get("pin")?.toString();
  const challenge = formData.get("challenge")?.toString();
  const signatureBlock = formData.get("signature")?.toString();

  const ADMIN_PATH = sessionData.role === "STAFF" ? "/moderator" : "/" + requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev");

  const throttleKey = `staff:${sessionData.userId}`;
  if (!await assertAuthNotLocked(throttleKey)) {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "BLOCKED", userId: sessionData.userId });
    return redirect(`${ADMIN_PATH}/verify?error=temporarily_locked`);
  }
  // Count attempts before verification so concurrent failures cannot evade the limit.
  await recordAuthFailure(throttleKey);

  // 1. Check MSID (Fixed from .env)
  const masterMsid = sessionData.role === "ADMIN" ? requiredProductionEnv("ADMIN_MSID", "STAFF-DEV-01") : undefined;
  if (sessionData.role === "ADMIN" && !constantTimeStringEquals(msidInput, masterMsid || "")) {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "FAILURE", userId: sessionData.userId, details: "IDENTITY" });
    return redirect(`${ADMIN_PATH}/verify?error=INVALID_IDENTITY`);
  }

  // 2. Fetch Admin User details
  const user = await prisma.user.findUnique({
    where: { id: sessionData.userId as string }
  });

  if (!user || user.isBanned) return redirect("/auth/login");

  // 3. Check PIN
  if (!verifyPin(pinInput, user.pin)) {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "FAILURE", userId: user.id, details: "PIN" });
    return redirect(`${ADMIN_PATH}/verify?error=INVALID_CREDENTIALS`);
  }

  // 4. Verify PGP Signature
  if (!user.pgpPublicKey || !signatureBlock || !challenge) {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "FAILURE", userId: user.id, details: "MISSING_PROOF" });
    return redirect(`${ADMIN_PATH}/verify?error=MISSING_CRYPTOGRAPHIC_PROOF`);
  }

  if (!await consumeAuthChallenge(prisma, user.id, challenge, "STAFF")) {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "FAILURE", userId: user.id, details: "CHALLENGE" });
    return redirect(`${ADMIN_PATH}/verify?error=CHALLENGE_EXPIRED`);
  }

  try {
    const publicKey = await openpgp.readKey({ armoredKey: user.pgpPublicKey });
    const signature = await openpgp.readSignature({ armoredSignature: signatureBlock });
    const message = await openpgp.createMessage({ text: challenge });

    const verificationResult = await openpgp.verify({
      message,
      signature,
      verificationKeys: publicKey
    });

    if (!verificationResult.signatures.length) throw new Error("MissingSignature");
    await verificationResult.signatures[0].verified;
  } catch {
    await recordSecurityEvent({ category: "STAFF_VERIFICATION", outcome: "FAILURE", userId: user.id, details: "SIGNATURE" });
    return redirect(`${ADMIN_PATH}/verify?error=SIGNATURE_VERIFICATION_FAILED`);
  }
  await clearAuthFailures(throttleKey);
  await upgradeStaffSession();
  return redirect(`${ADMIN_PATH}?success=ACCESS_GRANTED`);
}

async function upgradeStaffSession() {
  const cookieStore = await cookies();
  const currentToken = cookieStore.get("os_sid_v2")?.value;
  if (!currentToken) return redirect("/auth/login?error=SESSION_LOST");

  const upgraded = await upgradeStaffSessionToken(currentToken);
  if (!upgraded) return redirect("/auth/login?error=SESSION_LOST");

  cookieStore.set("os_sid_v2", upgraded.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    priority: "high",
    expires: upgraded.expiresAt,
    maxAge: upgraded.maxAge,
  });
}
