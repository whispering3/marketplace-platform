import { EncryptJWT, jwtDecrypt } from "jose";
import { SHIELD_AUDIENCE, TOKEN_ISSUER, scopedEncryptionKey } from "./token-security";

const shieldKey = () => scopedEncryptionKey("shield");

export interface ShieldPayload {
  captcha: string;
  failedCount: number;
  blockedUntil?: number;
  iat?: number;
  exp?: number;
}

export async function encryptShield(payload: ShieldPayload) {
  return new EncryptJWT(payload as any)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SHIELD_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .encrypt(await shieldKey());
}

export async function decryptShield(token: string | undefined): Promise<ShieldPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await shieldKey(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      issuer: TOKEN_ISSUER,
      audience: SHIELD_AUDIENCE,
    });
    return payload as unknown as ShieldPayload;
  } catch {
    return null;
  }
}
