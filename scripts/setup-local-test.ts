import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { generateKey } from "openpgp";
import { hashPin } from "../src/lib/pin";

const DATABASE_NAME = "market_demo_localhost";
const ARTIFACT_DIR = ".local-test";
const credentials = {
  buyer: { username: "demo_buyer", password: "DemoBuyer#2026!", pin: "123456" },
  vendor: { username: "demo_vendor", password: "DemoVendor#2026!", pin: "654321" },
  moderator: { username: "demo_moderator", password: "DemoModerator#2026!", pin: "445566" },
  admin: { username: "demo_admin", password: "DemoAdmin#2026!", pin: "112233" },
};

function passwordHash(password: string, salt: string) {
  return pbkdf2Sync(password, salt, 600000, 64, "sha512").toString("hex");
}

function quoteEnv(value: string) {
  return JSON.stringify(value);
}

async function main() {
  dotenv.config({ path: ".env" });
  const sourceUrl = new URL(process.env.DATABASE_URL || "");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(sourceUrl.hostname)) {
    throw new Error("Local test setup requires DATABASE_URL to point to local PostgreSQL.");
  }

  const controlUrl = new URL(sourceUrl);
  controlUrl.pathname = "/postgres";
  controlUrl.search = "";
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${DATABASE_NAME}`;
  const control = new Pool({ connectionString: controlUrl.toString() });
  try {
    const existing = await control.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE_NAME]);
    if (existing.rowCount === 0) await control.query(`CREATE DATABASE "${DATABASE_NAME}"`);
  } finally {
    await control.end();
  }

  const adminPath = `staff-local-${randomBytes(12).toString("hex")}`;
  const adminMsid = `LOCAL-${randomBytes(6).toString("hex").toUpperCase()}`;
  const setupKey = randomBytes(36).toString("base64url");
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: testUrl.toString(),
    DEMO_DATABASE_NAME: DATABASE_NAME,
    ALLOW_DEMO_SEED: "true",
    SESSION_SECRET: randomBytes(48).toString("base64"),
    AUTH_SALT: randomBytes(32).toString("base64"),
    SETUP_KEY: setupKey,
    ADMIN_URL_SECRET: adminPath,
    ADMIN_MSID: adminMsid,
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    DEPLOYMENT_ID: `local-${Date.now()}`,
    ONION_URL: "http://localhost:3000",
    PUBLIC_ONION_MIRRORS: "",
    SERVER_ACTION_ALLOWED_ORIGINS: "localhost:3000,127.0.0.1:3000",
    HONEYPOT_ENABLED: "false",
    XMR_RPC_URL: "http://127.0.0.1:9/json_rpc",
    XMR_RPC_USER: "local_test_rpc",
    XMR_RPC_PASS: randomBytes(24).toString("base64url"),
    WALLET_SYNC_SECRET: randomBytes(36).toString("base64url"),
    ADMIN_XMR_ADDRESS: "LOCAL_TEST_NO_REAL_TRANSFERS",
    XMR_RPC_TIMEOUT_MS: "250",
    PORT: "3000",
  };

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const envNames = [
    "NODE_ENV", "DATABASE_URL", "DEMO_DATABASE_NAME", "SESSION_SECRET", "AUTH_SALT", "SETUP_KEY",
    "ADMIN_URL_SECRET", "ADMIN_MSID", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
    "DEPLOYMENT_ID", "ONION_URL", "PUBLIC_ONION_MIRRORS", "SERVER_ACTION_ALLOWED_ORIGINS",
    "HONEYPOT_ENABLED", "XMR_RPC_URL", "XMR_RPC_USER", "XMR_RPC_PASS",
    "WALLET_SYNC_SECRET", "ADMIN_XMR_ADDRESS", "XMR_RPC_TIMEOUT_MS", "PORT",
  ];
  await writeFile(`${ARTIFACT_DIR}/runtime.env`, envNames.map((name) => `${name}=${quoteEnv(runtimeEnv[name] || "")}`).join("\n") + "\n", { mode: 0o600 });

  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: runtimeEnv, stdio: "inherit" });
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-demo-users.ts"], {
    env: { ...runtimeEnv, NODE_ENV: "development" },
    stdio: "inherit",
  });

  const pool = new Pool({ connectionString: testUrl.toString() });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const [buyerKey, vendorKey, adminKey, moderatorKey] = await Promise.all([
      generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Local Demo Buyer" }], format: "armored" }),
      generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Local Demo Vendor" }], format: "armored" }),
      generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Local Demo Administrator" }], format: "armored" }),
      generateKey({ type: "ecc", curve: "curve25519Legacy", userIDs: [{ name: "Local Demo Moderator" }], format: "armored" }),
    ]);
    const [buyer, vendor, admin] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { username: credentials.buyer.username } }),
      prisma.user.findUniqueOrThrow({ where: { username: credentials.vendor.username } }),
      prisma.user.findUniqueOrThrow({ where: { username: credentials.admin.username } }),
    ]);
    await Promise.all([
      prisma.user.update({ where: { id: buyer.id }, data: { pgpPublicKey: buyerKey.publicKey, sessionVersion: { increment: 1 } } }),
      prisma.user.update({ where: { id: vendor.id }, data: { pgpPublicKey: vendorKey.publicKey, sessionVersion: { increment: 1 } } }),
      prisma.user.update({ where: { id: admin.id }, data: { pgpPublicKey: adminKey.publicKey, staffId: adminMsid, sessionVersion: { increment: 1 } } }),
    ]);

    const salt = randomBytes(32).toString("hex");
    await prisma.user.upsert({
      where: { username: credentials.moderator.username },
      update: {
        passwordHash: passwordHash(credentials.moderator.password, salt), passwordSalt: salt,
        pin: hashPin(credentials.moderator.pin), pgpPublicKey: moderatorKey.publicKey,
        role: "STAFF", staffId: null, staffPermissions: ["products", "orders", "support"],
        isBanned: false, isPhraseViewed: true, sessionVersion: { increment: 1 },
      },
      create: {
        username: credentials.moderator.username,
        passwordHash: passwordHash(credentials.moderator.password, salt), passwordSalt: salt,
        pin: hashPin(credentials.moderator.pin), pgpPublicKey: moderatorKey.publicKey,
        role: "STAFF", staffPermissions: ["products", "orders", "support"],
        isPhraseViewed: true, antiPhishingPhrase: "Moderator Green Beacon", trustScore: 100,
      },
    });
    await prisma.marketConfig.upsert({ where: { id: "global_config" }, update: {}, create: { id: "global_config" } });
    await prisma.platformWallet.upsert({ where: { id: "market_wallet" }, update: {}, create: { id: "market_wallet" } });

    await Promise.all([
      writeFile(`${ARTIFACT_DIR}/buyer-private-key.asc`, buyerKey.privateKey, { mode: 0o600 }),
      writeFile(`${ARTIFACT_DIR}/vendor-private-key.asc`, vendorKey.privateKey, { mode: 0o600 }),
      writeFile(`${ARTIFACT_DIR}/admin-private-key.asc`, adminKey.privateKey, { mode: 0o600 }),
      writeFile(`${ARTIFACT_DIR}/moderator-private-key.asc`, moderatorKey.privateKey, { mode: 0o600 }),
    ]);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  const report = [
    "LOCAL TEST ONLY - NEVER USE THESE CREDENTIALS IN PRODUCTION", "",
    "URL: http://localhost:3000", `Administrator URL: http://localhost:3000/${adminPath}`, "",
    `Buyer: ${credentials.buyer.username} / ${credentials.buyer.password} / PIN ${credentials.buyer.pin}`,
    `Vendor: ${credentials.vendor.username} / ${credentials.vendor.password} / PIN ${credentials.vendor.pin}`,
    `Moderator: ${credentials.moderator.username} / ${credentials.moderator.password} / PIN ${credentials.moderator.pin}`,
    `Administrator: ${credentials.admin.username} / ${credentials.admin.password} / PIN ${credentials.admin.pin} / MSID ${adminMsid}`,
    "", "PGP private keys:",
    "  .local-test/buyer-private-key.asc", "  .local-test/vendor-private-key.asc",
    "  .local-test/admin-private-key.asc", "  .local-test/moderator-private-key.asc", "",
    "PGP helper examples (copy the armored challenge/message first):",
    "  Get-Clipboard | npm run local:test:pgp -- decrypt buyer",
    "  Get-Clipboard | npm run local:test:pgp -- decrypt vendor",
    "  Get-Clipboard | npm run local:test:pgp -- decrypt admin",
    "  Get-Clipboard | npm run local:test:pgp -- sign admin",
    "  Get-Clipboard | npm run local:test:pgp -- decrypt moderator",
    "  Get-Clipboard | npm run local:test:pgp -- sign moderator",
  ].join("\n") + "\n";
  await writeFile(`${ARTIFACT_DIR}/credentials.txt`, report, { mode: 0o600 });
  console.log(`\n${report}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
