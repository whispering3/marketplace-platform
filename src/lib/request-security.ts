import "server-only";

import { NextResponse } from "next/server";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeHost(value?: string | null) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function configuredRequestHosts() {
  const values = [
    process.env.ONION_URL,
    process.env.STAFF_ONION_URL,
    ...(process.env.PUBLIC_ONION_MIRRORS?.split(",") ?? []),
    ...(process.env.SERVER_ACTION_ALLOWED_ORIGINS?.split(",") ?? []),
  ];
  return new Set(values.map(normalizeHost).filter((host): host is string => Boolean(host)));
}

export function isConfiguredStaffHost(hostHeader: string | null) {
  if (!process.env.STAFF_ONION_URL) return true;
  return normalizeHost(hostHeader) === normalizeHost(process.env.STAFF_ONION_URL);
}

export function isTrustedRequestHost(hostHeader: string | null) {
  const host = normalizeHost(hostHeader);
  if (!host) return false;
  const hostname = new URL(`http://${host}`).hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  if (process.env.NODE_ENV !== "production") return true;
  return configuredRequestHosts().has(host);
}

export function rejectUntrustedHost(request: Request) {
  return isTrustedRequestHost(request.headers.get("host"))
    ? null
    : NextResponse.json({ error: "Unrecognized request host." }, { status: 421 });
}

export function rejectUnsafeMutation(request: Request, maxBytes = 65_536) {
  const hostError = rejectUntrustedHost(request);
  if (hostError) return hostError;

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxBytes) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  const origin = request.headers.get("origin");
  const sameSite = request.headers.get("sec-fetch-site") === "same-origin";
  const host = request.headers.get("host")?.toLowerCase();
  let validOrigin = false;
  try {
    const parsed = origin ? new URL(origin) : null;
    validOrigin = Boolean(parsed && host && parsed.host.toLowerCase() === host && ["http:", "https:"].includes(parsed.protocol));
  } catch {
    validOrigin = false;
  }
  if (!validOrigin && !(origin === "null" && sameSite)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  return null;
}
