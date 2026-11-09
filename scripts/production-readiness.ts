import dotenv from "dotenv";
import { prisma } from "../src/lib/db";

dotenv.config({ path: ".env.production" });

const requiredEnv = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "AUTH_SALT",
  "ADMIN_URL_SECRET",
  "ADMIN_XMR_ADDRESS",
  "XMR_RPC_URL",
  "XMR_RPC_USER",
  "XMR_RPC_PASS",
  "WALLET_SYNC_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "DEPLOYMENT_ID",
  "ONION_URL",
];

const forbiddenFragments = [
  "replace_me",
  "change_before_deploy",
  "your_",
  "securepassword",
  "development_",
  "olympus_initial_boot",
];

function assertSecret(name: string, minLength: number) {
  const value = process.env[name] || "";
  const lower = value.toLowerCase();
  if (value.length < minLength) {
    throw new Error(`${name} is too short for production`);
  }
  if (forbiddenFragments.some((fragment) => lower.includes(fragment))) {
    throw new Error(`${name} still contains a placeholder/default value`);
  }
}

function assertOnionUrl() {
  const raw = process.env.ONION_URL || "";
  const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (!parsed.hostname.endsWith(".onion")) {
    throw new Error("ONION_URL must point to a .onion host");
  }
}

function assertOptionalStaffOnionUrl() {
  const raw = process.env.STAFF_ONION_URL;
  if (!raw) return;
  const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
  if (!parsed.hostname.endsWith(".onion") || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("STAFF_ONION_URL must be a clean .onion origin");
  }
  const primary = new URL((process.env.ONION_URL || "").includes("://") ? process.env.ONION_URL! : `http://${process.env.ONION_URL}`);
  if (parsed.hostname === primary.hostname) throw new Error("STAFF_ONION_URL must differ from ONION_URL");
}

function assertLocalWalletRpc() {
  const raw = process.env.XMR_RPC_URL || "";
  const parsed = new URL(raw);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error("XMR_RPC_URL must be bound to localhost for production wallet safety");
  }
}

async function main() {
  const { callRpc } = await import("../src/lib/monero-rpc");
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing production env: ${missing.join(", ")}`);
  }

  assertSecret("SESSION_SECRET", 48);
  assertSecret("AUTH_SALT", 32);
  assertSecret("ADMIN_URL_SECRET", 16);
  assertSecret("WALLET_SYNC_SECRET", 32);
  assertSecret("XMR_RPC_USER", 8);
  assertSecret("XMR_RPC_PASS", 16);
  if (Buffer.from(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY || "", "base64").length !== 32) throw new Error("NEXT_SERVER_ACTIONS_ENCRYPTION_KEY must be a base64 encoded 32-byte key shared by all app instances");
  assertOnionUrl();
  assertOptionalStaffOnionUrl();
  assertLocalWalletRpc();

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(`Database check failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const config = await prisma.marketConfig.findUnique({ where: { id: "global_config" } });

  if (!config) {
    throw new Error("Missing MarketConfig global_config row");
  }

  if (config.globalCommission !== 0.04) {
    throw new Error(`Invalid global commission: ${config.globalCommission}`);
  }

  try {
    await callRpc("get_version");
  } catch (error) {
    throw new Error(`Monero wallet RPC check failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  console.log(JSON.stringify({
    ok: true,
    database: "up",
    moneroWalletRpc: "up",
    globalCommission: config.globalCommission,
  }, null, 2));
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
