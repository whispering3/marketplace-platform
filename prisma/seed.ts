import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.production" });
dotenv.config();

function normalizeOnionHost(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

function uniqueHosts(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map(normalizeOnionHost).filter((host): host is string => Boolean(host))));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed official onion domains.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: ["error"],
  });

  try {
    const primaryHost = normalizeOnionHost(process.env.ONION_URL);
    const mirrorHosts = uniqueHosts(process.env.PUBLIC_ONION_MIRRORS?.split(",") ?? []);

    if (!primaryHost || !primaryHost.endsWith(".onion")) {
      throw new Error("ONION_URL must be set to your primary .onion host before seeding mirrors.");
    }

    const officialHosts = uniqueHosts([primaryHost, ...mirrorHosts]).filter((host) => host.endsWith(".onion"));

    console.log("--- OLYMPUS: OFFICIAL ONION DOMAIN SEED ---");

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

    console.log(`Official onion grid synced: 1 primary + ${officialHosts.length - 1} mirrors.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
