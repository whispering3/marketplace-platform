
import { localRedirect } from "@/lib/local-redirect";
import { initializeShieldCookie } from "@/lib/captcha-sentinel";
import { rejectUnsafeMutation } from "@/lib/request-security";
import { GATE_ID_COOKIE, checkSentinelRate, gateIdCookieOptions } from "@/lib/sentinel-rate-limit";
import { recordSecurityEvent } from "@/lib/security-events";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request, 4096);
  if (rejected) return rejected;
  const rate = await checkSentinelRate(request, "start");
  if (!rate.allowed) {
    await recordSecurityEvent({ category: "SENTINEL_START", outcome: "BLOCKED", subject: rate.subjectHash });
    const response = localRedirect(`/?error=${encodeURIComponent("GATEWAY RATE LIMIT REACHED. Try again later.")}`);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    response.cookies.set(GATE_ID_COOKIE, rate.gateId, gateIdCookieOptions);
    return response;
  }
  return startSentinelSession(rate.gateId);
}

async function startSentinelSession(gateId: string) {
  const sealed = await initializeShieldCookie();
  const response = localRedirect("/");

  response.cookies.set("os_gate_v2", sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  response.cookies.set(GATE_ID_COOKIE, gateId, gateIdCookieOptions);

  return response;
}
