import { verifySentinelToken } from "./lib/sentinel-token";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { requiredProductionEnv } from "./lib/env";
import { isConfiguredStaffHost, isTrustedRequestHost } from "./lib/request-security";
import { SESSION_AUDIENCE, TOKEN_ISSUER, scopedSigningKey } from "./lib/token-security";

const OLYMPUS_SECRET = requiredProductionEnv(
  "SESSION_SECRET",
  "development_session_secret_change_before_deploy"
);
const encodedKey = scopedSigningKey("session");

async function getVaultRewriteProof(adminSecret: string) {
  const material = new TextEncoder().encode(`${OLYMPUS_SECRET}:${adminSecret}:vault-rewrite`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * OLYMPUS UNIFIED SHIELD (The Proxy)
 * Consolidates Sentinel, Proxy, Honeypot, and RBAC into a single secure entry point.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = normalizeOpaqueSameSiteOrigin(request);

  const ADMIN_SECRET = requiredProductionEnv("ADMIN_URL_SECRET", "staff-dev");
  const HONEYPOT_ON = process.env.HONEYPOT_ENABLED === "true";

  if (!isTrustedRequestHost(request.headers.get("host"))) {
    return injectSecurityHeaders(new NextResponse("Misdirected Request", { status: 421 }));
  }

  // 1. Static and Public Assets - Bypass
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/auth/logout'
  ) {
    return injectSecurityHeaders(NextResponse.next());
  }

  // 2. Honeypot Trap
  const isHoneypot = pathname === "/admin" || pathname.startsWith("/admin/");
  if (isHoneypot && HONEYPOT_ON) {
    return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl("/seized", request)));
  }

  // 3. Sentinel Gate (Anti-DDoS)
  const isSentinelVerified = await verifySentinelToken(request.cookies.get('os_sentinel_v2')?.value);
  const isSeizedPage = pathname === "/seized";
  const isGateway = pathname === '/';
  const isAuthRoute = pathname.startsWith('/auth');

  if (!isSentinelVerified && !isGateway && !isSeizedPage && !isAuthRoute) {
    return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/', request)));
  }

  // 4. Admin Site Obfuscation Check
  const isAccessingSecretAdmin = (pathname === "/" + ADMIN_SECRET || pathname.startsWith("/" + ADMIN_SECRET + "/"));
  const isAccessingInternalVault = pathname.startsWith("/staff-vault");
  const isStaffSurface = isAccessingSecretAdmin || isAccessingInternalVault || pathname === "/moderator" || pathname.startsWith("/moderator/");
  if (isStaffSurface && !isConfiguredStaffHost(request.headers.get("host"))) {
    return injectSecurityHeaders(new NextResponse(null, { status: 404 }));
  }
  const vaultRewriteProof = await getVaultRewriteProof(ADMIN_SECRET);
  const isTrustedVaultRewrite = isAccessingInternalVault
    && request.headers.get("x-olympus-vault-rewrite") === vaultRewriteProof;

  // Prevent direct access to /staff-vault
  if (isAccessingInternalVault && !isTrustedVaultRewrite) {
    return new NextResponse(null, { status: 404 });
  }
  if (isTrustedVaultRewrite) {
    return injectSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  }

  // Bootstrap has its own one-time database check and SETUP_KEY validation.
  if (pathname === `/${ADMIN_SECRET}/boot`) {
    const bootstrapUrl = publicRequestUrl("/staff-vault/boot", request);
    bootstrapUrl.search = request.nextUrl.search;
    return injectSecurityHeaders(NextResponse.rewrite(bootstrapUrl, { request: { headers: requestHeaders } }));
  }

  // 5. Authentication & RBAC
  const sessionToken = request.cookies.get('os_sid_v2')?.value;

  if (pathname.startsWith('/market') || pathname === '/moderator' || pathname.startsWith('/moderator/') || isAccessingSecretAdmin) {
    if (!sessionToken) {
      return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/auth/login', request)));
    }

    try {
      const { payload } = await jwtVerify(sessionToken, encodedKey, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: SESSION_AUDIENCE,
      });

      const role = (payload as any).role;
      const isStaffVerified = (payload as any).isStaffVerified;

      if (pathname === "/moderator" || pathname.startsWith("/moderator/")) {
        if (role !== "STAFF") return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl(role === "ADMIN" ? `/${ADMIN_SECRET}` : "/market", request)));
        if (!isStaffVerified && pathname !== "/moderator/verify") return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl("/moderator/verify", request)));
      }

      // Handle Admin Dashboard through Secret URL
      if (isAccessingSecretAdmin) {
        const internalPath = pathname.replace("/" + ADMIN_SECRET, "/staff-vault");

        if (role === 'STAFF') return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/moderator', request)));
        if (role !== 'ADMIN') {
           return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/market', request)));
        }

        // Enforce Staff-2FA verification if required
        if (!isStaffVerified && internalPath !== "/staff-vault/verify" && internalPath !== "/staff-vault/boot") {
            return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl("/" + ADMIN_SECRET + "/verify", request)));
        }

        const rewriteUrl = publicRequestUrl(internalPath, request);
        rewriteUrl.search = request.nextUrl.search;
        requestHeaders.set("x-olympus-vault-rewrite", vaultRewriteProof);

        return injectSecurityHeaders(NextResponse.rewrite(rewriteUrl, {
          request: { headers: requestHeaders },
        }));
      }

      // Standard Dashboard RBAC
      if (pathname.startsWith('/market/admin') && role !== 'ADMIN') {
        return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/market?error=ADMIN_PRIVILEGES_REQUIRED', request)));
      }

      if (pathname.startsWith('/market/dashboard/vendor') && role !== 'VENDOR' && role !== 'ADMIN') {
        return injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/market?error=VENDOR_ACCESS_REQUIRED', request)));
      }

    } catch {
      const response = injectSecurityHeaders(NextResponse.redirect(publicRequestUrl('/auth/login?error=SESSION_EXPIRED', request)));
      response.cookies.delete('os_sid_v2');
      return response;
    }
  }

  // Auth pages remain reachable so expired or revoked sessions can sign in again.
  return injectSecurityHeaders(NextResponse.next({
    request: { headers: requestHeaders },
  }));
}

function publicRequestUrl(path: string, request: NextRequest) {
  // Next normalizes loopback URLs internally. Preserve the actual incoming host for proxy responses.
  const origin = new URL(request.url);
  const host = request.headers.get("host");
  if (host) {
    const checked = new URL(`${origin.protocol}//${host}`);
    if (checked.host !== host || checked.username || checked.password) throw new Error("InvalidRequestHost");
    origin.host = checked.host;
  }
  const protocol = request.headers.get("x-forwarded-proto");
  if (protocol === "http" || protocol === "https") origin.protocol = `${protocol}:`;
  return new URL(path, origin);
}

function normalizeOpaqueSameSiteOrigin(request: NextRequest) {
  const headers = new Headers(request.headers);

  if (request.method !== "POST" || headers.get("origin") !== "null") {
    return headers;
  }

  if (headers.get("sec-fetch-site") !== "same-origin") return headers;
  const host = headers.get("host");
  if (!host) {
    return headers;
  }

  const proto = headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  headers.set("origin", `${proto}://${host}`);
  return headers;
}

/**
 * SECURITY HEADER INJECTION
 */
function injectSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  response.headers.set("Server", "HIDDEN_NODE");
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|.*\\.(?:ico|svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
