
import { localRedirect } from "@/lib/local-redirect";

import { issueSentinelToken } from "@/lib/sentinel-token";
import { getShieldSession } from "@/lib/captcha-sentinel";
import { encryptShield } from "@/lib/auth-utils";
import crypto from "node:crypto";
import { rejectUnsafeMutation } from "@/lib/request-security";
import { GATE_ID_COOKIE, checkSentinelRate, clearSentinelRate, gateIdCookieOptions } from "@/lib/sentinel-rate-limit";
import { recordSecurityEvent } from "@/lib/security-events";

export const dynamic = "force-dynamic";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789!#%&*+?";

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request, 4096);
  if (rejected) return rejected;
  const rate = await checkSentinelRate(request, "verify");
  if (!rate.allowed) {
    await recordSecurityEvent({ category: "SENTINEL_VERIFY", outcome: "BLOCKED", subject: rate.subjectHash });
    const response = redirectTo(request, `/?error=${encodeURIComponent("GATEWAY RATE LIMIT REACHED. Try again later.")}`);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    response.cookies.set(GATE_ID_COOKIE, rate.gateId, gateIdCookieOptions);
    return response;
  }
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

  const formData = await request.formData();
  const userInput = formData.get("captcha")?.toString().toUpperCase();
  const session = await getShieldSession();

  if (!session) {
    return redirectTo(request, "/");
  }

  if (session.blockedUntil && session.blockedUntil > Date.now()) {
    const remaining = Math.ceil((session.blockedUntil - Date.now()) / 1000);
    return redirectTo(request, `/?error=${encodeURIComponent(`GATEWAY BLOCKED: Wait ${remaining}s.`)}`);
  }

  if (userInput === session.captcha) {
    await clearSentinelRate(rate.subjectHash);
    await recordSecurityEvent({ category: "SENTINEL_VERIFY", outcome: "SUCCESS", subject: rate.subjectHash });
    const response = redirectTo(request, "/auth/login");
    response.cookies.set("os_sentinel_v2", await issueSentinelToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 2,
      sameSite: "strict",
      path: "/",
    });
    response.cookies.delete("os_gate_v2");
    response.cookies.set(GATE_ID_COOKIE, rate.gateId, gateIdCookieOptions);
    return response;
  }

  const failedCount = session.failedCount + 1;
  await recordSecurityEvent({ category: "SENTINEL_VERIFY", outcome: "FAILURE", subject: rate.subjectHash });

  if (failedCount >= 3) {
    const response = redirectTo(
      request,
      `/?error=${encodeURIComponent("BRUTE FORCE DETECTED: 1 minute lockdown initiated.")}`
    );
    response.cookies.set("os_gate_v2", await encryptShield({
      captcha: session.captcha,
      failedCount: 0,
      blockedUntil: Date.now() + 60000,
      iat: Math.floor(Date.now() / 1000),
    }), gatewayCookieOptions());
    return response;
  }

  const response = redirectTo(
    request,
    `/?error=${encodeURIComponent(`INCORRECT CAPTCHA. Attempts remaining: ${3 - failedCount}`)}`
  );
  response.cookies.set("os_gate_v2", await encryptShield({
    captcha: generateCaptcha(),
    failedCount,
    iat: Math.floor(Date.now() / 1000),
  }), gatewayCookieOptions());

  return response;
}

function redirectTo(request: Request, path: string) {
  return localRedirect(path);
}

function gatewayCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
}

function generateCaptcha() {
  const randomBytes = crypto.randomBytes(8);
  const length = 6 + (randomBytes[0] % 2);
  let captcha = "";

  for (let i = 1; i <= length; i++) {
    captcha += alphabet.charAt(randomBytes[i] % alphabet.length);
  }

  return captcha;
}
