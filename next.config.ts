import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

function getLocalActionOrigins() {
  const normalizeOriginHost = (value?: string) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
      return parsed.host;
    } catch {
      return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    }
  };

  const configured = process.env.SERVER_ACTION_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];
  const onionHosts = [
    process.env.ONION_URL,
    process.env.STAFF_ONION_URL,
    ...(process.env.PUBLIC_ONION_MIRRORS?.split(",") ?? []),
  ]
    .map(normalizeOriginHost)
    .filter((origin): origin is string => Boolean(origin));

  const localNetworkHosts = Object.values(networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `${entry.address}:3000`);

  return Array.from(new Set([
    "localhost:3000",
    "127.0.0.1:3000",
    "[::1]:3000",
    ...onionHosts,
    ...(process.env.NODE_ENV === "production" ? [] : localNetworkHosts),
    ...configured,
  ]));
}

const serverActionAllowedOrigins = getLocalActionOrigins();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Preserve mirror hosts in proxy destinations; normalization changes loopback hosts to localhost.
  skipProxyUrlNormalize: true,
  deploymentId: process.env.DEPLOYMENT_ID,
  experimental: {
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
    },
  },
  // Strict allowed origins for specialized marketplace environments
  allowedDevOrigins: serverActionAllowedOrigins,
  // MILITARY GRADE SECURITY HEADERS
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'off'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'no-referrer'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()'
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin'
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'same-origin'
          },
          {
            key: 'X-Permitted-Cross-Domain-Policies',
            value: 'none'
          },
          {
            key: 'X-XSS-Protection',
            value: '0'
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; child-src 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self';"
          }
        ],
      },
      {
        source: '/auth/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        source: '/moderator/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        source: `/${process.env.ADMIN_URL_SECRET || 'staff-dev'}/:path*`,
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ]
  },
};

export default nextConfig;
