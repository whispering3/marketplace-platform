const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");
require("dotenv").config({ path: ".env.production" });
require("dotenv").config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to sync onion domains.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

function normalizeOnionHost(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

function uniqueHosts(values) {
  return Array.from(new Set(values.map(normalizeOnionHost).filter(Boolean)));
}

async function main() {
  const primaryHost = normalizeOnionHost(process.env.ONION_URL);
  const mirrorHosts = uniqueHosts(process.env.PUBLIC_ONION_MIRRORS?.split(",") ?? []);

  if (!primaryHost || !primaryHost.endsWith(".onion")) {
    throw new Error("ONION_URL must be set to your primary .onion host before syncing mirrors.");
  }

  const officialHosts = uniqueHosts([primaryHost, ...mirrorHosts]).filter((host) => host.endsWith(".onion"));

  console.log("--- OLYMPUS: OFFICIAL ONION DOMAIN SYNC ---");
  console.log(`Primary: ${primaryHost}`);
  console.log(`Mirrors: ${officialHosts.filter((host) => host !== primaryHost).length}`);

  await prisma.$transaction(async (tx) => {
    await tx.publicMirror.upsert({
      where: { url: primaryHost },
      update: { status: "ONLINE", isPrimary: true },
      create: { url: primaryHost, status: "ONLINE", isPrimary: true },
    });

    await tx.publicMirror.updateMany({
      where: { url: { not: primaryHost }, isPrimary: true },
      data: { isPrimary: false },
    });

    for (const host of officialHosts.filter((host) => host !== primaryHost)) {
      await tx.publicMirror.upsert({
        where: { url: host },
        update: { status: "ONLINE", isPrimary: false },
        create: { url: host, status: "ONLINE", isPrimary: false },
      });
    }

    await tx.publicMirror.updateMany({
      where: {
        url: { notIn: officialHosts },
        status: "ONLINE",
      },
      data: { status: "DEPRECATED", isPrimary: false },
    });
  });

  console.log("Official onion domains synced.");
}

main()
  .catch((err) => {
    console.error("Domain sync failed:", err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
