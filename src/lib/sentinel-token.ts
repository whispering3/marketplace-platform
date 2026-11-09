import { SignJWT, jwtVerify } from "jose";
import { SENTINEL_AUDIENCE, TOKEN_ISSUER, scopedSigningKey } from "./token-security";

const key = () => scopedSigningKey("sentinel");

export async function issueSentinelToken() {
  return new SignJWT({ verified: true }).setProtectedHeader({ alg: "HS256" })
    .setIssuer(TOKEN_ISSUER).setAudience(SENTINEL_AUDIENCE).setIssuedAt().setExpirationTime("2h").sign(key());
}

export async function verifySentinelToken(token?: string) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: SENTINEL_AUDIENCE,
    });
    return payload.verified === true;
  } catch { return false; }
}
