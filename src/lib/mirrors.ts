import { headers } from "next/headers";
import { prisma } from "./db";

export type DomainStatus = "PRIMARY" | "OFFICIAL_MIRROR" | "UNAUTHORIZED";

export type OfficialMirror = {
  id: string;
  url: string;
  status: string;
  isPrimary: boolean;
};

export function normalizeMirrorHost(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

export function mirrorHref(url: string) {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `http://${url}`;
}

function getEnvOfficialMirrors(): OfficialMirror[] {
  const primary = process.env.ONION_URL ? normalizeMirrorHost(process.env.ONION_URL) : null;
  const mirrors = (process.env.PUBLIC_ONION_MIRRORS || "")
    .split(",")
    .map((url) => normalizeMirrorHost(url.trim()))
    .filter(Boolean);

  const rows: OfficialMirror[] = [];
  const seen = new Set<string>();

  for (const url of [primary, ...mirrors]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({
      id: `env:${url}`,
      url,
      status: "ONLINE",
      isPrimary: url === primary,
    });
  }

  return rows;
}

export async function getOfficialMirrors(): Promise<OfficialMirror[]> {
  const envMirrors = getEnvOfficialMirrors();
  const mirrorMap = new Map(envMirrors.map((mirror) => [mirror.url, mirror]));

  const dbMirrors = await prisma.publicMirror.findMany({
    where: { status: "ONLINE" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  for (const mirror of dbMirrors) {
    const normalized = normalizeMirrorHost(mirror.url);
    mirrorMap.set(normalized, {
      id: mirror.id,
      url: normalized,
      status: mirror.status,
      isPrimary: mirror.isPrimary || mirrorMap.get(normalized)?.isPrimary || false,
    });
  }

  return Array.from(mirrorMap.values()).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/**
 * OLYMPUS: SANCTUM GRID - DYNAMIC DOMAIN VERIFIER
 * Detects if the user is visiting via the primary domain,
 * an official mirror, or an unauthorized (phishing) link.
 */
export async function verifyCurrentDomain(): Promise<{
  host: string;
  status: DomainStatus;
  primaryUrl?: string;
}> {
  const headerList = await headers();
  const host = headerList.get("host") || "";

  // Strip port if exists
  const cleanHost = host.split(":")[0];

  // Fetch all mirrors for cross-referencing
  const mirrors = await getOfficialMirrors();
  const primary = mirrors.find(m => m.isPrimary);

  const current = mirrors.find(m => normalizeMirrorHost(m.url) === cleanHost.toLowerCase());
  const isPrivateStaffHost = process.env.STAFF_ONION_URL
    ? normalizeMirrorHost(process.env.STAFF_ONION_URL) === cleanHost.toLowerCase()
    : false;

  let status: DomainStatus = "UNAUTHORIZED";

  if (current) {
    status = current.isPrimary ? "PRIMARY" : "OFFICIAL_MIRROR";
  } else if (isPrivateStaffHost) {
    status = "OFFICIAL_MIRROR";
  }

  return {
    host: cleanHost,
    status,
    primaryUrl: primary?.url
  };
}
