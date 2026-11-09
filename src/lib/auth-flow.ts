import "server-only";

import crypto from "crypto";
import { promisify } from "node:util";
import { validatePgpEncryptionPublicKey } from "@/lib/pgp-key";
import { issueAuthChallenge, consumeAuthChallenge } from "./auth-challenges";
import { prisma } from "@/lib/db";
import { generateAntiPhishingPhrase } from "@/lib/phrases";
import { hashPin, isValidPinFormat } from "@/lib/pin";
import { requiredProductionEnv } from "@/lib/env";
import {
  assertAuthNotLocked,
  clearAuthFailures,
  isStrongPassword,
  isValidUsername,
  normalizeUsername,
  recordAuthFailure,
  verifyHashSafe,
  constantTimeStringEquals,
} from "@/lib/auth-hardening";
import type { PendingAuthState } from "@/lib/auth-flow-cookie";
import { recordSecurityEvent } from "@/lib/security-events";
import * as openpgp from "openpgp";

export type LoginSessionRequest = {
  userId: string;
  sessionVersion: number;
  role: string;
  username?: string;
  staffId?: string | null;
};

export type AuthFlowResult = {
  redirectTo: string;
  session?: LoginSessionRequest;
  pendingAuth?: PendingAuthState | null;
};

export async function hashPassword(password: string, salt: string): Promise<string> {
  return (await promisify(crypto.pbkdf2)(password, salt, 600000, 64, "sha512")).toString("hex");
}

export async function registerUserFromForm(formData: FormData): Promise<AuthFlowResult> {
  const username = normalizeUsername(formData.get("username")?.toString() || "");
  const password = formData.get("password")?.toString();
  const pin = formData.get("pin")?.toString();
  const pgpPublicKey = formData.get("pgp_public_key")?.toString() || null;
  const referralCode = formData.get("referral_code")?.toString()?.trim();

  if (!username || !password || !isValidUsername(username) || !isStrongPassword(password) || !isValidPinFormat(pin)) {
    return { redirectTo: "/auth/login?mode=register&error=invalid_inputs" };
  }

  if (pgpPublicKey) {
    if (!await validatePgpEncryptionPublicKey(pgpPublicKey)) {
      return { redirectTo: "/auth/login?mode=register&error=invalid_pgp_key" };
    }
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    return { redirectTo: "/auth/login?mode=register&error=username_taken" };
  }

  let referredById = null;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { affiliateCode: referralCode } });
    if (referrer && referrer.username !== username) {
      referredById = referrer.id;
    }
  }

  const userSalt = crypto.randomBytes(32).toString("hex");

  try {
    await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password, userSalt),
        passwordSalt: userSalt,
        pin: hashPin(pin),
        pgpPublicKey,
        antiPhishingPhrase: generateAntiPhishingPhrase(),
        referredById,
      },
    });
    await recordSecurityEvent({ category: "ACCOUNT_REGISTRATION", outcome: "SUCCESS", subject: username });
    return { redirectTo: "/auth/login?registered=1" };
  } catch (error) {
    console.error(error);
    return { redirectTo: "/auth/login?mode=register&error=database_error" };
  }
}

export async function startLoginFromForm(formData: FormData): Promise<AuthFlowResult> {
  const username = normalizeUsername(formData.get("username")?.toString() || "");
  const password = formData.get("password")?.toString();

  if (!username || !password || password.length > 256 || !isValidUsername(username)) {
    return { redirectTo: "/auth/login?error=invalid_inputs" };
  }

  if (!(await assertAuthNotLocked(`login:${username}`))) {
    await recordSecurityEvent({ category: "PASSWORD_LOGIN", outcome: "BLOCKED", subject: username });
    return { redirectTo: "/auth/login?error=temporarily_locked" };
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !verifyHashSafe(await hashPassword(password, user.passwordSalt), user.passwordHash)) {
    await recordAuthFailure(`login:${username}`);
    await recordSecurityEvent({ category: "PASSWORD_LOGIN", outcome: "FAILURE", subject: username });
    return { redirectTo: "/auth/login?error=unauthorized" };
  }

  if (user.isBanned) {
    await recordAuthFailure(`login:${username}`);
    await recordSecurityEvent({ category: "PASSWORD_LOGIN", outcome: "BLOCKED", userId: user.id });
    return { redirectTo: "/auth/login?error=account_suspended" };
  }

  await clearAuthFailures(`login:${username}`);
  await recordSecurityEvent({ category: "PASSWORD_LOGIN", outcome: "SUCCESS", userId: user.id });
  const verifyToken = await issueAuthChallenge(prisma, user.id, "PASSWORD", user.sessionVersion);

  if (user.pgpPublicKey && user.pgpPublicKey.includes("BEGIN PGP PUBLIC KEY BLOCK")) {
    return {
      redirectTo: "/auth/login?step=verify_url&next=2fa",
      pendingAuth: { step: "verify_url", next: "2fa", token: verifyToken, userId: user.id },
    };
  }

  return {
    redirectTo: "/auth/login?step=verify_url&next=complete",
    pendingAuth: { step: "verify_url", next: "complete", token: verifyToken, userId: user.id },
  };
}

async function preparePgpChallenge(publicKeyArmored: string) {
  const token = crypto.randomBytes(6).toString("hex").toUpperCase();
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  const encryptedMessage = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: `Login verification token: ${token}` }),
    encryptionKeys: publicKey,
  });
  return {
    token,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    encryptedMessage,
  };
}

export async function completeLoginFromForm(formData: FormData, pending?: PendingAuthState | null): Promise<AuthFlowResult> {
  const userId = pending?.step === "verify_url" ? pending.userId : formData.get("userId")?.toString();
  const confirmed = formData.get("url_confirmed")?.toString();
  const token = pending?.step === "verify_url" ? pending.token : formData.get("token")?.toString();

  if (!userId || confirmed !== "yes" || !token) {
    return { redirectTo: "/auth/login?error=url_not_confirmed" };
  }

  const passwordProof = await consumeAuthChallenge(prisma, userId, token, "PASSWORD");
  if (!passwordProof) {
    return { redirectTo: "/auth/login?error=invalid_or_expired_token" };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.isBanned || user.sessionVersion !== passwordProof.sessionVersion) {
    return { redirectTo: "/auth/login?error=unauthorized" };
  }

  if (user.pgpPublicKey) {
    const prepared = await preparePgpChallenge(user.pgpPublicKey);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const challenge = await prisma.pgpChallenge.create({
      data: {
        userId: user.id,
        tokenHash: prepared.tokenHash,
        encryptedMessage: prepared.encryptedMessage,
        expiresAt,
        sessionVersion: user.sessionVersion,
      },
    });
    return {
      redirectTo: "/auth/login?step=2fa",
      pendingAuth: { step: "2fa", userId, challengeId: challenge.id },
    };
  }

  const enrollmentToken = await issueAuthChallenge(prisma, user.id, "PGP_ENROLLMENT", user.sessionVersion);
  return {
    redirectTo: "/auth/login?step=pgp_setup",
    pendingAuth: { step: "pgp_setup", userId: user.id, token: enrollmentToken },
  };
}

export async function enrollPgpFromForm(formData: FormData, pending?: PendingAuthState | null): Promise<AuthFlowResult> {
  const userId = pending?.step === "pgp_setup" ? pending.userId : formData.get("userId")?.toString();
  const token = pending?.step === "pgp_setup" ? pending.token : formData.get("token")?.toString();
  const armoredKey = formData.get("pgp_public_key")?.toString().trim();
  if (!userId || !token) {
    return { redirectTo: "/auth/login?error=InvalidOrExpiredEnrollment" };
  }
  const retryPath = "/auth/login?step=pgp_setup";
  if (!armoredKey || armoredKey.length > 32768) {
    return { redirectTo: `${retryPath}&error=PGPKeyRequired` };
  }

  if (!await validatePgpEncryptionPublicKey(armoredKey)) {
    return { redirectTo: `${retryPath}&error=InvalidEncryptionKey` };
  }

  const prepared = await preparePgpChallenge(armoredKey);

  const challenge = await prisma.$transaction(async (tx) => {
    const proof = await consumeAuthChallenge(tx, userId, token, "PGP_ENROLLMENT");
    if (!proof) return null;
    const claimed = await tx.user.updateMany({
      where: { id: userId, sessionVersion: proof.sessionVersion, pgpPublicKey: null, isBanned: false },
      data: { pgpPublicKey: armoredKey, sessionVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    const updated = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
    return tx.pgpChallenge.create({
      data: {
        userId,
        tokenHash: prepared.tokenHash,
        encryptedMessage: prepared.encryptedMessage,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        sessionVersion: updated.sessionVersion,
      },
    });
  });

  if (!challenge) return { redirectTo: "/auth/login?error=InvalidOrExpiredEnrollment" };
  return {
    redirectTo: "/auth/login?step=2fa&enrolled=1",
    pendingAuth: { step: "2fa", userId, challengeId: challenge.id },
  };
}

export async function verifyPgpLoginFromForm(formData: FormData, pending?: PendingAuthState | null): Promise<AuthFlowResult> {
  const token = formData.get("pgp_token")?.toString().trim().toUpperCase();
  const userId = pending?.step === "2fa" ? pending.userId : formData.get("userId")?.toString();
  const challengeId = pending?.step === "2fa" ? pending.challengeId : formData.get("challengeId")?.toString();

  if (!token || !userId || !challengeId) {
    return { redirectTo: "/auth/login?error=invalid_2fa" };
  }

  if (!(await assertAuthNotLocked(`pgp:${userId}`))) {
    await recordSecurityEvent({ category: "PGP_LOGIN", outcome: "BLOCKED", userId });
    return { redirectTo: "/auth/login?step=2fa&error=temporarily_locked" };
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.isBanned) {
    return { redirectTo: "/auth/login?error=unauthorized" };
  }

  const challenge = await prisma.pgpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge || challenge.userId !== userId || challenge.sessionVersion !== user.sessionVersion || challenge.used || challenge.expiresAt < new Date()) {
    return { redirectTo: "/auth/login?step=2fa&error=expired_or_invalid_challenge" };
  }

  const suppliedHash = crypto.createHash("sha256").update(token).digest("hex");
  const tokenMatches = challenge.tokenHash
    ? constantTimeStringEquals(suppliedHash, challenge.tokenHash)
    : Boolean(challenge.token && constantTimeStringEquals(token, challenge.token));
  if (!tokenMatches) {
    await recordAuthFailure(`pgp:${userId}`);
    await recordSecurityEvent({ category: "PGP_LOGIN", outcome: "FAILURE", userId });
    return { redirectTo: "/auth/login?step=2fa&error=incorrect_token" };
  }

  const consumed = await prisma.pgpChallenge.updateMany({ where: { id: challenge.id, userId, used: false, expiresAt: { gt: new Date() } }, data: { used: true } });
  if (consumed.count !== 1) return { redirectTo: "/auth/login?error=expired_or_invalid_challenge" };
  await clearAuthFailures(`pgp:${userId}`);
  await recordSecurityEvent({ category: "PGP_LOGIN", outcome: "SUCCESS", userId });
  if (!user.isPhraseViewed) {
    const phraseToken = await issueAuthChallenge(prisma, user.id, "PHRASE", user.sessionVersion);
    return {
      redirectTo: "/auth/login?step=phrase_reveal",
      pendingAuth: { step: "phrase_reveal", userId: user.id, token: phraseToken },
    };
  }

  return {
    redirectTo: getPostLoginDestination(user.role),
    session: {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      role: user.role,
      username: user.username,
      staffId: user.role === "ADMIN" ? user.staffId : null,
    },
    pendingAuth: null,
  };
}

export async function markPhraseViewedFromForm(formData: FormData, pending?: PendingAuthState | null): Promise<AuthFlowResult> {
  const userId = pending?.step === "phrase_reveal" ? pending.userId : formData.get("userId")?.toString();
  const token = pending?.step === "phrase_reveal" ? pending.token : formData.get("token")?.toString();

  const phraseProof = userId && token ? await consumeAuthChallenge(prisma, userId, token, "PHRASE") : false;
  if (!userId || !token || !phraseProof) {
    return { redirectTo: "/auth/login?error=invalid_or_expired_token" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, username: true, staffId: true, isBanned: true, sessionVersion: true },
  });
  if (!user || user.isBanned || user.sessionVersion !== phraseProof.sessionVersion) {
    return { redirectTo: "/auth/login?error=unauthorized" };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { isPhraseViewed: true },
  });

  return {
    redirectTo: getPostLoginDestination(user.role),
    session: {
      userId,
      sessionVersion: user.sessionVersion,
      role: user.role,
      username: user.username,
      staffId: user.role === "ADMIN" ? user.staffId : null,
    },
    pendingAuth: null,
  };
}

function getPostLoginDestination(role: string): string {
  if (role === "STAFF") return "/moderator/verify";
  if (role === "ADMIN") {
    return `/${requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev")}/verify`;
  }
  if (role === "VENDOR") return "/market/dashboard/vendor?tab=operations";

  return "/market/news";
}
