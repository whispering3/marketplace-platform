import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { randomUUID } from "node:crypto";
import { SESSION_AUDIENCE, TOKEN_ISSUER, scopedSigningKey } from "./token-security";
import { recordSecurityEvent } from "./security-events";

const encodedKey = scopedSigningKey("session");
const STANDARD_SESSION_SECONDS = 12 * 60 * 60;
const PRIVILEGED_SESSION_SECONDS = 30 * 60;
const PRIVILEGED_IDLE_SECONDS = 15 * 60;

export interface SessionPayload {
  userId: string;
  sessionVersion: number;
  sessionId: string;
  role: string;
  username?: string;
  isStaffVerified?: boolean;
  msid?: string;
  expiresAt: Date;
}

/**
 * SOVEREIGN SESSION LAYER V2.5
 * Military-grade JWT signing for Olympus Marketplace.
 */

export async function encrypt(payload: any) {
  const maxAge = sessionMaxAgeSeconds(payload.role);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(String(payload.userId))
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(encodedKey);
}

export async function decrypt(session: string | undefined = "") {
  if (!session) return null;
  try {
    const { payload } = await jwtVerify(session, encodedKey, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(userId: string, role: string, username?: string, msid?: string, knownVersion?: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { sessionVersion: true } });
  const created = await createSessionToken({ userId, role, username, msid, sessionVersion: knownVersion ?? user.sessionVersion });

  (await cookies()).set("os_sid_v2", created.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: created.expiresAt,
    sameSite: "strict",
    path: "/",
    priority: "high"
  });
}

export async function createSessionToken(input: Omit<SessionPayload, "expiresAt" | "sessionId" | "isStaffVerified">) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds(input.role) * 1000);
  await prisma.authSession.create({
    data: { id: sessionId, userId: input.userId, role: input.role, expiresAt },
  });
  await recordSecurityEvent({ category: "SESSION_CREATED", outcome: "SUCCESS", userId: input.userId, details: input.role });
  const token = await encrypt({ ...input, sessionId, expiresAt });
  return { token, expiresAt, maxAge: sessionMaxAgeSeconds(input.role) };
}

export function sessionMaxAgeSeconds(role?: string) {
  return role === "ADMIN" || role === "STAFF"
    ? PRIVILEGED_SESSION_SECONDS
    : STANDARD_SESSION_SECONDS;
}

function isStoredSessionActive(session: { role: string; userId: string; revokedAt: Date | null; expiresAt: Date; lastSeenAt: Date }, userId: unknown) {
  if (session.userId !== userId || session.revokedAt || session.expiresAt <= new Date()) return false;
  return !["ADMIN", "STAFF"].includes(session.role)
    || session.lastSeenAt.getTime() > Date.now() - PRIVILEGED_IDLE_SECONDS * 1000;
}

/**
 * Verifies authentication AND account status (Bans, Nukes)
 * This is called in layouts and sensitive pages.
 */
export async function verifyAuth(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const session = cookieStore.get("os_sid_v2")?.value;
  const payload = await decrypt(session);

  if (!payload?.userId) {
    redirect("/auth/login?error=AUTH_REQUIRED");
  }

  // Deep Audit: Check DB for ban status every hit (Cache this in prod if high traffic)
  if (typeof payload.sessionId !== "string") redirect("/auth/login?error=SESSION_EXPIRED");
  const [user, storedSession] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.userId as string },
      select: { isBanned: true, role: true, username: true, sessionVersion: true },
    }),
    prisma.authSession.findUnique({ where: { id: payload.sessionId as string } }),
  ]);

  if (!user || user.isBanned || (payload.sessionVersion ?? 0) !== user.sessionVersion || !storedSession || !isStoredSessionActive(storedSession, payload.userId)) {
    redirect("/auth/login?error=ACCOUNT_SUSPENDED");
  }

  if (storedSession.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000) {
    await prisma.authSession.updateMany({ where: { id: storedSession.id, revokedAt: null }, data: { lastSeenAt: new Date() } });
  }

  return { ...payload, role: user.role, username: user.username } as unknown as SessionPayload;
}

export async function getSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get("os_sid_v2")?.value;
  if (!session) return null;
  const payload = await decrypt(session);
  if (typeof payload?.userId !== "string") return null;
  if (typeof payload.sessionId !== "string") return null;
  const [user, storedSession] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.userId }, select: { role: true, isBanned: true, username: true, sessionVersion: true } }),
    prisma.authSession.findUnique({ where: { id: payload.sessionId } }),
  ]);
  return user && !user.isBanned && (payload.sessionVersion ?? 0) === user.sessionVersion && storedSession && isStoredSessionActive(storedSession, payload.userId)
    ? { ...payload, userId: payload.userId, role: user.role, username: user.username }
    : null;
}

export async function deleteSession() {
  await revokeCurrentSession();
  redirect("/auth/login");
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const payload = await decrypt(cookieStore.get("os_sid_v2")?.value);
  if (typeof payload?.sessionId === "string") {
    await prisma.authSession.updateMany({ where: { id: payload.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordSecurityEvent({ category: "SESSION_LOGOUT", outcome: "SUCCESS", userId: typeof payload.userId === "string" ? payload.userId : null });
  }
  cookieStore.delete("os_sid_v2");
}

export async function upgradeStaffSessionToken(currentToken: string) {
  const payload = await decrypt(currentToken);
  if (typeof payload?.userId !== "string" || typeof payload.sessionId !== "string" || !["ADMIN", "STAFF"].includes(String(payload.role))) {
    return null;
  }
  const expiresAt = new Date(Date.now() + PRIVILEGED_SESSION_SECONDS * 1000);
  const updated = await prisma.authSession.updateMany({
    where: { id: payload.sessionId, userId: payload.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt, lastSeenAt: new Date(), role: String(payload.role) },
  });
  if (updated.count !== 1) return null;
  await recordSecurityEvent({ category: "STAFF_SESSION_UPGRADE", outcome: "SUCCESS", userId: payload.userId, details: String(payload.role) });
  return {
    token: await encrypt({ ...payload, isStaffVerified: true, expiresAt }),
    expiresAt,
    maxAge: PRIVILEGED_SESSION_SECONDS,
  };
}
