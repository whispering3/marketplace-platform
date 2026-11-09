import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type Database = PrismaClient | Prisma.TransactionClient;
export type AuthPurpose = "PASSWORD" | "PHRASE" | "STAFF" | "PGP_ENROLLMENT";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function issueAuthChallenge(db: Database, userId: string, purpose: AuthPurpose, expectedVersion?: number) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  const token = randomBytes(32).toString("hex");
  await db.authChallenge.create({ data: {
    userId, purpose, sessionVersion: expectedVersion ?? user.sessionVersion, tokenHash: hash(token), expiresAt: new Date(Date.now() + 600_000),
  } });
  return token;
}

export async function checkAuthChallenge(db: Database, userId: string, token: string, purpose: AuthPurpose) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, isBanned: true } });
  if (!user || user.isBanned) return false;
  return !!await db.authChallenge.findFirst({ where: {
    userId, sessionVersion: user.sessionVersion, tokenHash: hash(token), purpose, used: false, expiresAt: { gt: new Date() },
  } });
}

export async function consumeAuthChallenge(db: Database, userId: string, token: string, purpose: AuthPurpose) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, isBanned: true } });
  if (!user || user.isBanned) return false;
  const result = await db.authChallenge.updateMany({ where: {
    userId, sessionVersion: user.sessionVersion, tokenHash: hash(token), purpose, used: false, expiresAt: { gt: new Date() },
  }, data: { used: true } });
  return result.count === 1 ? { sessionVersion: user.sessionVersion } : false;
}
