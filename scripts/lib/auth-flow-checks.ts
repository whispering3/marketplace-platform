import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { issueAuthChallenge, checkAuthChallenge, consumeAuthChallenge } from "../../src/lib/auth-challenges";
import { decrypt, generateKey, readMessage, readPrivateKey } from "openpgp";
import { SignJWT } from "jose";
import { SESSION_AUDIENCE, TOKEN_ISSUER, scopedSigningKey } from "../../src/lib/token-security";

export async function testAuthFlows(db: PrismaClient) {
  // The application singleton points only to the disposable integration database.
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  const flow = await import("../../src/lib/auth-flow");
  const { issueSentinelToken, verifySentinelToken } = await import("../../src/lib/sentinel-token");
  const { encryptShield, decryptShield } = await import("../../src/lib/auth-utils");
  const sentinel = await issueSentinelToken();
  assert.ok(await verifySentinelToken(sentinel));
  assert.ok(!await verifySentinelToken("true"));
  assert.ok(!await verifySentinelToken(`${sentinel}tampered`));
  const shield = await encryptShield({ captcha: "TEST-CAPTCHA", failedCount: 0 });
  assert.equal(shield.split(".").length, 5, "Captcha is encrypted, not a readable signed JWT");
  assert.equal((await decryptShield(shield))?.captcha, "TEST-CAPTCHA");
  assert.equal(await decryptShield(sentinel), null, "Sentinel and captcha proofs are not interchangeable");
  const sessionProof = await new SignJWT({ userId: "token-domain-test", sessionId: "test", sessionVersion: 0, role: "BUYER" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(scopedSigningKey("session"));
  assert.equal(await verifySentinelToken(sessionProof), false, "Session and Sentinel proofs are not interchangeable");
  const { recordAuthFailure, assertAuthNotLocked } = await import("../../src/lib/auth-hardening");
  await Promise.all(Array.from({ length: 8 }, () => recordAuthFailure("test-concurrent-attempts")));
  assert.ok(!await assertAuthNotLocked("test-concurrent-attempts"));
  await recordAuthFailure("test-concurrent-attempts");
  assert.ok(!await assertAuthNotLocked("test-concurrent-attempts"), "A later failure must not clear an active lock");
  const { clearRateLimit, consumeRateLimit } = await import("../../src/lib/rate-limit");
  const rateKey = `integration-rate-${Date.now()}`;
  assert.ok((await consumeRateLimit(rateKey, { limit: 2, windowSeconds: 60, blockSeconds: 60 })).allowed);
  assert.ok((await consumeRateLimit(rateKey, { limit: 2, windowSeconds: 60, blockSeconds: 60 })).allowed);
  assert.ok(!(await consumeRateLimit(rateKey, { limit: 2, windowSeconds: 60, blockSeconds: 60 })).allowed);
  await clearRateLimit(rateKey);

  const form = (values: Record<string, string>) => {
    const result = new FormData();
    for (const [key, value] of Object.entries(values)) result.set(key, value);
    return result;
  };
  const pgp = await generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Auth Flow Test" }], format: "armored" });
  const user = await db.user.create({ data: {
    username: "auth_pgp", passwordSalt: "integration-salt", passwordHash: await flow.hashPassword("TestPassword123!", "integration-salt"),
    pgpPublicKey: pgp.publicKey, isPhraseViewed: false,
  } });
  const login = await flow.startLoginFromForm(form({ username: user.username, password: "TestPassword123!" }));
  const token = login.pendingAuth?.token;
  assert.ok(token);
  assert.ok(!/[?&](token|userId|cid)=/.test(login.redirectTo));
  assert.ok(await checkAuthChallenge(db, user.id, token, "PASSWORD"));
  assert.ok(!await checkAuthChallenge(db, user.id, token, "PHRASE"));
  assert.equal((await flow.markPhraseViewedFromForm(form({ userId: user.id, token }))).session, undefined);
  const complete = await flow.completeLoginFromForm(form({ next: "complete", url_confirmed: "yes" }), login.pendingAuth);
  assert.equal(complete.session, undefined, "Client-supplied next must not bypass PGP");
  const cid = complete.pendingAuth?.challengeId;
  assert.ok(cid);
  assert.equal((await flow.completeLoginFromForm(form({ url_confirmed: "yes" }), login.pendingAuth)).session, undefined);
  const challenge = await db.pgpChallenge.findUniqueOrThrow({ where: { id: cid } });
  assert.equal(challenge.token, null, "PGP token is not stored in plaintext");
  assert.ok(challenge.tokenHash && challenge.encryptedMessage);
  const decrypted = await decrypt({
    message: await readMessage({ armoredMessage: challenge.encryptedMessage }),
    decryptionKeys: await readPrivateKey({ armoredKey: pgp.privateKey }),
  });
  const pgpToken = String(decrypted.data).match(/[A-F0-9]{12}/)?.[0];
  assert.ok(pgpToken);
  const results = await Promise.all([1, 2].map(() => flow.verifyPgpLoginFromForm(form({ pgp_token: pgpToken }), complete.pendingAuth)));
  const successful = results.filter((result) => result.redirectTo.includes("phrase_reveal"));
  assert.equal(successful.length, 1, "PGP challenge is atomically consumed");
  assert.ok(!/[?&](token|userId|cid)=/.test(successful[0].redirectTo));
  const sessions = await Promise.all([1, 2].map(() => flow.markPhraseViewedFromForm(form({}), successful[0].pendingAuth)));
  assert.equal(sessions.filter((result) => result.session).length, 1);
  for (const purpose of ["PASSWORD", "PHRASE", "STAFF"] as const) {
    const proof = await issueAuthChallenge(db, user.id, purpose);
    assert.ok(!await checkAuthChallenge(db, "another-user", proof, purpose));
    const consumed = await Promise.all([1, 2].map(() => consumeAuthChallenge(db, user.id, proof, purpose)));
    assert.equal(consumed.filter(Boolean).length, 1);
    const expired = await issueAuthChallenge(db, user.id, purpose);
    await db.authChallenge.updateMany({ where: { userId: user.id, used: false }, data: { expiresAt: new Date(0) } });
    assert.ok(!await consumeAuthChallenge(db, user.id, expired, purpose));
  }
  const revoked = await issueAuthChallenge(db, user.id, "PASSWORD");
  await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  assert.ok(!await checkAuthChallenge(db, user.id, revoked, "PASSWORD"));
  const bannedToken = await issueAuthChallenge(db, user.id, "PHRASE");
  await db.user.update({ where: { id: user.id }, data: { isBanned: true } });
  assert.equal((await flow.markPhraseViewedFromForm(form({ userId: user.id, token: bannedToken }))).session, undefined);
}
