import "server-only";

import { createHmac } from "node:crypto";
import { prisma } from "./db";
import { requiredProductionEnv } from "./env";

type RateLimitOptions = {
  limit: number;
  windowSeconds: number;
  blockSeconds: number;
};

export function blindRateLimitSubject(value: string) {
  const secret = requiredProductionEnv(
    "SESSION_SECRET",
    "development_session_secret_change_before_deploy",
  );
  return createHmac("sha256", `${secret}:rate-limit:v1`).update(value).digest("hex");
}

export async function consumeRateLimit(key: string, options: RateLimitOptions) {
  const rows = await prisma.$queryRaw<Array<{ count: number; blockedUntil: Date | null }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "blockedUntil", "updatedAt")
    VALUES (${key}, 1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), NULL, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."blockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN "RateLimitBucket"."count"
        WHEN "RateLimitBucket"."windowStart" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ${options.windowSeconds} * INTERVAL '1 second' THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitBucket"."windowStart" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ${options.windowSeconds} * INTERVAL '1 second'
          THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        ELSE "RateLimitBucket"."windowStart"
      END,
      "blockedUntil" = CASE
        WHEN "RateLimitBucket"."blockedUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') THEN "RateLimitBucket"."blockedUntil"
        WHEN "RateLimitBucket"."windowStart" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ${options.windowSeconds} * INTERVAL '1 second' THEN NULL
        WHEN "RateLimitBucket"."count" + 1 > ${options.limit}
          THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + ${options.blockSeconds} * INTERVAL '1 second'
        ELSE NULL
      END,
      "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    RETURNING "count", "blockedUntil"
  `;
  const result = rows[0];
  const now = Date.now();
  const allowed = Boolean(result && (!result.blockedUntil || result.blockedUntil.getTime() <= now) && result.count <= options.limit);
  return {
    allowed,
    retryAfterSeconds: !allowed && result?.blockedUntil
      ? Math.max(1, Math.ceil((result.blockedUntil.getTime() - now) / 1000))
      : 0,
  };
}

export async function clearRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
