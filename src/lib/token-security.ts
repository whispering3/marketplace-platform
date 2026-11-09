import { requiredProductionEnv } from "./env";

export const TOKEN_ISSUER = "olympus-market";
export const SESSION_AUDIENCE = "olympus-session";
export const SENTINEL_AUDIENCE = "olympus-sentinel";
export const SHIELD_AUDIENCE = "olympus-shield";
export const AUTH_FLOW_AUDIENCE = "olympus-auth-flow";

function rootSecret() {
  return requiredProductionEnv(
    "SESSION_SECRET",
    "development_session_secret_change_before_deploy",
  );
}

export function scopedSigningKey(scope: "session" | "sentinel") {
  return new TextEncoder().encode(`${rootSecret()}:signing:${scope}:v1`);
}

export async function scopedEncryptionKey(scope: "shield" | "auth-flow") {
  const material = new TextEncoder().encode(`${rootSecret()}:encryption:${scope}:v1`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}
