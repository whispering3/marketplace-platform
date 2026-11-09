import "server-only";

import crypto from "crypto";
import { prisma } from "@/lib/db";

const MAX_AUTH_FAILURES = 6;
const LOCKOUT_MINUTES = 15;

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string) {
  return /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
}

export function isStrongPassword(password: string) {
  return (
    password.length >= 12 &&
    password.length <= 256 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

export function verifyHashSafe(candidateHash: string, storedHash?: string | null) {
  if (!storedHash) return false;
  const candidate = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

export async function assertAuthNotLocked(key: string) {
  const normalizedKey = key.trim().toLowerCase();
  const row = await prisma.authThrottle.findUnique({ where: { key: normalizedKey } });

  if (row?.lockedUntil && row.lockedUntil > new Date()) {
    return false;
  }


  return true;
}

export async function recordAuthFailure(key: string) {
  const normalizedKey = key.trim().toLowerCase();
  await prisma.$executeRaw`
    INSERT INTO "AuthThrottle" ("key", "failures", "updatedAt") VALUES (${normalizedKey}, 1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "failures" = CASE
        WHEN "AuthThrottle"."lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN "AuthThrottle"."failures"
        WHEN "AuthThrottle"."lockedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN 1
        ELSE "AuthThrottle"."failures" + 1 END,
      "lockedUntil" = CASE
        WHEN "AuthThrottle"."lockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN "AuthThrottle"."lockedUntil"
        WHEN "AuthThrottle"."lockedUntil" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN NULL
        WHEN "AuthThrottle"."failures" + 1 >= ${MAX_AUTH_FAILURES} THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ${LOCKOUT_MINUTES} * INTERVAL '1 minute'
        ELSE NULL END,
      "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
  `;
}

export async function clearAuthFailures(key: string) {
  await prisma.authThrottle.deleteMany({ where: { key: key.trim().toLowerCase() } });
}

export function constantTimeStringEquals(candidate: string | undefined | null, expected: string) {
  if (!candidate) return false;
  const left = Buffer.from(candidate, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
