import "dotenv/config";

import { closeDatabase, prisma } from "../src/lib/db";

async function main() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [authChallenges, pgpChallenges, authThrottle, rateBuckets, sessions, securityEvents] = await prisma.$transaction([
    prisma.authChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { used: true, createdAt: { lt: sevenDaysAgo } }] } }),
    prisma.pgpChallenge.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { used: true, createdAt: { lt: sevenDaysAgo } }] } }),
    prisma.authThrottle.deleteMany({ where: { updatedAt: { lt: sevenDaysAgo }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } }),
    prisma.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: sevenDaysAgo }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }] } }),
    prisma.authSession.deleteMany({ where: { OR: [{ expiresAt: { lt: sevenDaysAgo } }, { revokedAt: { lt: sevenDaysAgo } }] } }),
    prisma.securityEvent.deleteMany({ where: { createdAt: { lt: ninetyDaysAgo } } }),
  ]);

  console.log(JSON.stringify({
    ok: true,
    deleted: {
      authChallenges: authChallenges.count,
      pgpChallenges: pgpChallenges.count,
      authThrottle: authThrottle.count,
      rateBuckets: rateBuckets.count,
      sessions: sessions.count,
      securityEvents: securityEvents.count,
    },
  }));
}

main().finally(closeDatabase).catch((error) => {
  console.error(error instanceof Error ? error.message : "Security cleanup failed");
  process.exitCode = 1;
});
