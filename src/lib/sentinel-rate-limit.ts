import "server-only";

import { randomBytes } from "node:crypto";
import { blindRateLimitSubject, clearRateLimit, consumeRateLimit } from "./rate-limit";

export const GATE_ID_COOKIE = "os_gate_id_v1";

function cookieValue(request: Request, name: string) {
  return (request.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function gateIdentity(request: Request) {
  const existing = cookieValue(request, GATE_ID_COOKIE);
  const gateId = existing && /^[a-f0-9]{64}$/.test(existing)
    ? existing
    : randomBytes(32).toString("hex");
  const clientProfile = [
    gateId,
    request.headers.get("user-agent") || "unknown-agent",
    request.headers.get("accept-language") || "unknown-language",
  ].join("|");
  return { gateId, subjectHash: blindRateLimitSubject(clientProfile) };
}

export async function checkSentinelRate(request: Request, action: "start" | "verify") {
  const identity = gateIdentity(request);
  const local = await consumeRateLimit(`sentinel:${action}:${identity.subjectHash}`, action === "start"
    ? { limit: 30, windowSeconds: 600, blockSeconds: 900 }
    : { limit: 20, windowSeconds: 600, blockSeconds: 900 });
  const global = await consumeRateLimit(`sentinel:${action}:global`, action === "start"
    ? { limit: 600, windowSeconds: 60, blockSeconds: 60 }
    : { limit: 1_200, windowSeconds: 60, blockSeconds: 60 });
  return {
    ...identity,
    allowed: local.allowed && global.allowed,
    retryAfterSeconds: Math.max(local.retryAfterSeconds, global.retryAfterSeconds),
  };
}

export async function clearSentinelRate(subjectHash: string) {
  await Promise.all([
    clearRateLimit(`sentinel:start:${subjectHash}`),
    clearRateLimit(`sentinel:verify:${subjectHash}`),
  ]);
}

export const gateIdCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
  priority: "high" as const,
};
