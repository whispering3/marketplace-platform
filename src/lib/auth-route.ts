import "server-only";

import { localRedirect } from "@/lib/local-redirect";

import { createSessionToken } from "@/lib/session";
import type { AuthFlowResult } from "@/lib/auth-flow";
import { isShieldVerified } from "./captcha-sentinel";
import { rejectUnsafeMutation } from "./request-security";
import {
  AUTH_FLOW_COOKIE,
  openPendingAuthState,
  pendingAuthCookieOptions,
  sealPendingAuthState,
} from "./auth-flow-cookie";

export async function rejectUnsafeAuthRequest(request: Request) {
  const unsafe = rejectUnsafeMutation(request);
  if (unsafe) return unsafe;
  if (!await isShieldVerified()) return localRedirect("/");
  return null;
}

export async function authRedirectResponse(request: Request, result: AuthFlowResult) {
  const response = localRedirect(result.redirectTo);

  if (result.pendingAuth) {
    response.cookies.set(AUTH_FLOW_COOKIE, await sealPendingAuthState(result.pendingAuth), pendingAuthCookieOptions);
  } else if (result.pendingAuth === null || result.session) {
    response.cookies.delete(AUTH_FLOW_COOKIE);
  }

  if (result.session) {
    const session = await createSessionToken({
      userId: result.session.userId,
      sessionVersion: result.session.sessionVersion,
      role: result.session.role,
      username: result.session.username,
      msid: result.session.staffId || undefined,
    });

    response.cookies.set("os_sid_v2", session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      expires: session.expiresAt,
      sameSite: "strict",
      path: "/",
      priority: "high",
    });
  }

  return response;
}

export async function pendingAuthFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_FLOW_COOKIE}=`))
    ?.slice(AUTH_FLOW_COOKIE.length + 1);
  return openPendingAuthState(encoded ? decodeURIComponent(encoded) : undefined);
}
