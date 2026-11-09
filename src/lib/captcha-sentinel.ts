import { verifySentinelToken } from "./sentinel-token";
import { cookies } from "next/headers";
import { encryptShield, decryptShield, ShieldPayload } from "./auth-utils";

/**
 * CAPTCHA SENTINEL PROTOCOL V2.5
 * Military-grade session shielding for the Olympus Marketplace.
 */

const CAPTCHA_TTL_MS = 10 * 60 * 1000; // 10 Minutes TTL for solver

export async function getShieldSession(): Promise<ShieldPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("os_gate_v2")?.value;
  const session = await decryptShield(token);

  if (session && session.iat && (Date.now() - session.iat * 1000) > CAPTCHA_TTL_MS) {
    return null; // Expired session
  }

  if (session?.blockedUntil && session.blockedUntil <= Date.now()) {
    return {
      ...session,
      blockedUntil: undefined,
    };
  }

  return session;
}

export async function updateShieldSession(data: Partial<ShieldPayload>) {
  const current = await getShieldSession();
  const updated: ShieldPayload = {
    captcha: current?.captcha || "",
    failedCount: current?.failedCount || 0,
    blockedUntil: current?.blockedUntil,
    iat: current?.iat,
    ...data
  };
  const sealed = await encryptShield(updated);
  (await cookies()).set("os_gate_v2", sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: 'strict',
    path: '/'
  });
}

export async function generateNewCaptcha() {
  const crypto = await import("crypto");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789!#%&*+?";
  let newCaptcha = "";

  const randomBytes = crypto.randomBytes(8);
  const length = 6 + (randomBytes[0] % 2);

  for (let i = 1; i <= length; i++) {
    newCaptcha += alphabet.charAt(randomBytes[i] % alphabet.length);
  }

  await updateShieldSession({
    captcha: newCaptcha,
    iat: Math.floor(Date.now() / 1000)
  });
}

export async function isShieldVerified() {
  const cookieStore = await cookies();
  return verifySentinelToken(cookieStore.get("os_sentinel_v2")?.value);
}

export async function initializeShieldCookie() {
  const crypto = await import("crypto");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let newCaptcha = "";
  const randomBytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    newCaptcha += alphabet.charAt(randomBytes[i] % alphabet.length);
  }
  const initial: ShieldPayload = {
    captcha: newCaptcha,
    failedCount: 0,
    iat: Math.floor(Date.now() / 1000)
  };
  return await encryptShield(initial);
}
