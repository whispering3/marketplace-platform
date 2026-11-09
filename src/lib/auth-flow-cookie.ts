import "server-only";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import {
  AUTH_FLOW_AUDIENCE,
  TOKEN_ISSUER,
  scopedEncryptionKey,
} from "./token-security";

export const AUTH_FLOW_COOKIE = "os_auth_flow_v1";
export const AUTH_FLOW_MAX_AGE_SECONDS = 10 * 60;

export type PendingAuthState = {
  step: "verify_url" | "pgp_setup" | "2fa" | "phrase_reveal";
  userId: string;
  token?: string;
  challengeId?: string;
  next?: "2fa" | "complete";
};

export async function sealPendingAuthState(state: PendingAuthState) {
  return new EncryptJWT(state)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(AUTH_FLOW_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${AUTH_FLOW_MAX_AGE_SECONDS}s`)
    .encrypt(await scopedEncryptionKey("auth-flow"));
}

export async function openPendingAuthState(value?: string | null): Promise<PendingAuthState | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, await scopedEncryptionKey("auth-flow"), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      issuer: TOKEN_ISSUER,
      audience: AUTH_FLOW_AUDIENCE,
    });
    if (
      typeof payload.userId !== "string" ||
      !["verify_url", "pgp_setup", "2fa", "phrase_reveal"].includes(String(payload.step))
    ) return null;
    return payload as unknown as PendingAuthState;
  } catch {
    return null;
  }
}

export async function getPendingAuthState() {
  return openPendingAuthState((await cookies()).get(AUTH_FLOW_COOKIE)?.value);
}

export const pendingAuthCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: AUTH_FLOW_MAX_AGE_SECONDS,
  priority: "high" as const,
};
