import { queueRevenuePayout } from "../src/lib/revenue-payouts";
import { creditPlatformRevenue } from "../src/lib/platform-revenue";
import { testAuthFlows } from "./lib/auth-flow-checks";
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { requestWithdrawal, reviewWithdrawal, reconcileWithdrawal } from "../src/lib/withdrawals";
import { reserveOrderResources } from "../src/lib/order-reservation";
import { money, toPiconero, fromPiconero, parseMoney, atomicUnitsToXmr } from "../src/lib/money";
import { assertDemoSeedAllowed } from "./lib/demo-seed-guard";
import { hashPin, verifyPin } from "../src/lib/pin";
import { hasStaffPermission } from "../src/lib/staff-permissions";
import { syncIncomingDeposits } from "../src/lib/wallet-sync";

async function main() {
  assert.equal(money("0.1").plus("0.2").toFixed(12), "0.300000000000");
  assert.equal(toPiconero("-1.000000000001"), BigInt("-1000000000001"));
  assert.equal(toPiconero(1e-12), BigInt(1));
  assert.equal(fromPiconero(BigInt("9007199254740993123")).toFixed(12), "9007199.254740993123");
  for (const value of ["NaN", "Infinity", "1e3", "0.0000000000001", "12x"]) assert.throws(() => parseMoney(value));
  assert.throws(() => atomicUnitsToXmr(Number.MAX_SAFE_INTEGER + 1));
  const pin = hashPin("123456");
  assert.ok(verifyPin("123456", pin));
  assert.ok(!verifyPin("000000", pin));
  assert.ok(!hasStaffPermission({ role: "BUYER", isBanned: false, staffPermissions: ["wallets"] }, "wallets"));
  assert.ok(!hasStaffPermission({ role: "ADMIN", isBanned: true, staffPermissions: [] }, "wallets"));
  const demoEnv = { ALLOW_DEMO_SEED: "true", DEMO_DATABASE_NAME: "market_demo", DATABASE_URL: "postgresql://user:pass@localhost/market_demo" };
  assertDemoSeedAllowed(demoEnv);
  assert.throws(() => assertDemoSeedAllowed({ ...demoEnv, NODE_ENV: "production" }));
  assert.throws(() => assertDemoSeedAllowed({ ...demoEnv, DATABASE_URL: "postgresql://user:pass@external.example/market_demo" }));
  assert.throws(() => assertDemoSeedAllowed({ ...demoEnv, DEMO_DATABASE_NAME: "main" }));

  const baseUrl = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
    throw new Error("Integration tests require a local PostgreSQL server with CREATE DATABASE permission.");
  }
  const database = `market_test_${randomUUID().replaceAll("-", "")}`;
  if (!/^market_test_[a-f0-9]{32}$/.test(database)) throw new Error("InvalidTestDatabaseName");
  baseUrl.pathname = "/postgres";
  baseUrl.search = "";
  const control = new Pool({ connectionString: baseUrl.toString() });
  let created = false;
  let pool: Pool | undefined;
  let client: PrismaClient | undefined;
  try {
    await control.query(`CREATE DATABASE "${database}"`);
    created = true;
    baseUrl.pathname = `/${database}`;
    pool = new Pool({ connectionString: baseUrl.toString() });
    const migrations = (await readdir("prisma/migrations")).sort();
    for (const migration of migrations) {
      if (!/^\d/.test(migration)) continue;
      if (migration === "20260912100000_exact_money_and_withdrawal_processing") {
        await pool.query(`INSERT INTO "User" ("id", "username", "passwordHash", "affiliateCode", "walletBalanceXMR") VALUES ('legacy', 'legacy', 'unused', 'legacy', 0.1 + 0.2)`);
      }
      await pool.query(await readFile(`prisma/migrations/${migration}/migration.sql`, "utf8"));
    }
    client = new PrismaClient({ adapter: new PrismaPg(pool) });
    const db = client;
    await testAuthFlows(db);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: "legacy" } })).walletBalanceXMR.toFixed(12), "0.300000000000");
    assert.equal(await db.monetaryMigrationSnapshot.count({ where: { tableName: "User", recordId: "legacy" } }), 1);
    const createUser = (username: string, role: string, balance: string) => db.user.create({
      data: { username, role, passwordHash: "test-only", pin, walletBalanceXMR: balance },
    });
    const admin = await createUser("admin", "ADMIN", "0");
    await db.platformWallet.upsert({ where: { id: "market_wallet" }, update: { balanceXMR: "10" }, create: { id: "market_wallet", balanceXMR: "10" } });
    const payout = await db.$transaction(async (tx) => {
      await creditPlatformRevenue({ tx, amountXMR: "1", source: "VENDOR_BOND" });
      return queueRevenuePayout(tx, { userId: admin.id, amount: "1", sourceKey: "test:bond", address: "test-cold-wallet" });
    });
    assert.ok(payout);
    assert.equal((await db.platformWallet.findUniqueOrThrow({ where: { id: "market_wallet" } })).balanceXMR.toFixed(12), "10.000000000000", "Internal revenue must not create cash");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).walletBalanceXMR.toFixed(12), "0.000000000000", "Automatic payout reserves the admin credit");
    await reviewWithdrawal(db, { actorId: admin.id, requestId: payout.id, decision: "APPROVE" }, async () => ({ txHash: "f".repeat(64), networkFeeXMR: "0.001" }));
    assert.equal((await db.platformWallet.findUniqueOrThrow({ where: { id: "market_wallet" } })).balanceXMR.toFixed(12), "8.999000000000", "Outgoing principal and network fee reduce cash exactly once");
    await assert.rejects(reviewWithdrawal(db, { actorId: admin.id, requestId: payout.id, decision: "APPROVE" }, async () => { throw new Error("Must not send again"); }), /InvalidRequestState/);
    await db.financialLog.deleteMany({ where: { txHash: "f".repeat(64) } });
    await db.platformFinance.update({ where: { id: "treasury" }, data: { totalWithdrawalsProcessed: 0 } });
    const vendor = await createUser("vendor", "VENDOR", "0.300000000001");
    const buyer = await createUser("buyer", "BUYER", "0.2");
    const request = () => requestWithdrawal(db, { userId: vendor.id, address: "test-address", pin: "123456" });
    await assert.rejects(requestWithdrawal(db, { userId: vendor.id, address: "test-address", pin: "000000" }), /InvalidPIN/);
    const requests = await Promise.allSettled([request(), request()]);
    assert.equal(requests.filter(r => r.status === "fulfilled").length, 1);
    const withdrawal = await db.withdrawalRequest.findFirstOrThrow({ where: { userId: vendor.id } });
    assert.equal(withdrawal.amountXMR.toFixed(12), "0.300000000001");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: vendor.id } })).walletBalanceXMR.toString(), "0");
    let transferCalls = 0;
    const transfer = async () => { transferCalls++; return "a".repeat(64); };
    await assert.rejects(reviewWithdrawal(db, { actorId: buyer.id, requestId: withdrawal.id, decision: "APPROVE" }, transfer), /Unauthorized/);
    await assert.rejects(reviewWithdrawal(db, { actorId: admin.id, requestId: withdrawal.id, decision: "INVALID" }, transfer), /InvalidWithdrawalDecision/);
    const input = { actorId: admin.id, requestId: withdrawal.id, decision: "APPROVE" };
    const approvals = await Promise.allSettled([reviewWithdrawal(db, input, transfer), reviewWithdrawal(db, input, transfer)]);
    assert.equal(approvals.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(transferCalls, 1);
    assert.equal(await db.financialLog.count({ where: { type: "WITHDRAWAL" } }), 1);
    assert.equal((await db.platformFinance.findUniqueOrThrow({ where: { id: "treasury" } })).totalWithdrawalsProcessed.toFixed(12), "0.300000000001");

    await db.user.update({ where: { id: vendor.id }, data: { walletBalanceXMR: "1.000000000001" } });
    const rejected = await request();
    const rejectInput = { actorId: admin.id, requestId: rejected.id, decision: "REJECT" };
    const rejections = await Promise.allSettled([reviewWithdrawal(db, rejectInput, transfer), reviewWithdrawal(db, rejectInput, transfer)]);
    assert.equal(rejections.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: vendor.id } })).walletBalanceXMR.toFixed(12), "1.000000000001");
    const uncertain = await request();
    const uncertainInput = { actorId: admin.id, requestId: uncertain.id, decision: "APPROVE" };
    await assert.rejects(reviewWithdrawal(db, uncertainInput, async () => { throw new Error("timeout after sending"); }), /WithdrawalNeedsReview/);
    assert.equal((await db.withdrawalRequest.findUniqueOrThrow({ where: { id: uncertain.id } })).status, "NEEDS_REVIEW");
    await assert.rejects(reviewWithdrawal(db, uncertainInput, transfer), /InvalidRequestState/);
    await assert.rejects(reviewWithdrawal(db, { ...uncertainInput, decision: "REJECT" }, transfer), /InvalidRequestState/);
    const reconcile = { actorId: admin.id, requestId: uncertain.id, txHash: "b".repeat(64) };
    await assert.rejects(reconcileWithdrawal(db, reconcile, async () => false), /TransferNotVerified/);
    await reconcileWithdrawal(db, reconcile, async (hash, address, amount) => hash === "b".repeat(64) && address === "test-address" && money(amount).eq("1.000000000001"));
    await assert.rejects(reconcileWithdrawal(db, reconcile, async () => true), /InvalidRequestState/);
    assert.equal(await db.financialLog.count({ where: { type: "WITHDRAWAL" } }), 2);

    await db.user.update({ where: { id: vendor.id }, data: { walletBalanceXMR: "0.5" } });
    const accountingFailure = await request();
    await pool.query(`CREATE FUNCTION reject_withdrawal_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW."txHash" = '${"c".repeat(64)}' THEN RAISE EXCEPTION 'injected accounting failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_test_log BEFORE INSERT ON "FinancialLog" FOR EACH ROW EXECUTE FUNCTION reject_withdrawal_log();`);
    await assert.rejects(reviewWithdrawal(db, { actorId: admin.id, requestId: accountingFailure.id, decision: "APPROVE" }, async () => "c".repeat(64)), /WithdrawalNeedsReview/);
    const retained = await db.withdrawalRequest.findUniqueOrThrow({ where: { id: accountingFailure.id } });
    assert.equal(retained.txHash, "c".repeat(64));
    assert.equal(retained.status, "NEEDS_REVIEW");
    await pool.query('DROP TRIGGER reject_test_log ON "FinancialLog"; DROP FUNCTION reject_withdrawal_log();');
    await reconcileWithdrawal(db, { actorId: admin.id, requestId: retained.id, txHash: retained.txHash! }, async () => true);

    const depositWallet = await db.transactionWallet.create({ data: { userId: buyer.id, purpose: "DEPOSIT", address: "deposit-test-address", addressIndex: 123, expiresAt: new Date(Date.now() + 3600000) } });
    const incoming = [{ txid: "d".repeat(64), amount: "100000000001", confirmations: 100, unlocked: true, subaddr_index: { major: 0, minor: 123 } }];
    const pending = await syncIncomingDeposits(db, async () => incoming.map(t => ({ ...t, confirmations: 0 })));
    assert.equal(pending.credited, 0);
    const scans = await Promise.all([syncIncomingDeposits(db, async () => incoming), syncIncomingDeposits(db, async () => incoming)]);
    assert.equal(scans.reduce((sum, scan) => sum + scan.credited, 0), 1);
    assert.equal((await syncIncomingDeposits(db, async () => incoming)).credited, 0);
    assert.equal(await db.processedWalletPayment.count({ where: { transactionWalletId: depositWallet.id } }), 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).walletBalanceXMR.toFixed(12), "0.300000000001");
    await db.user.update({ where: { id: buyer.id }, data: { walletBalanceXMR: "0.2" } });

    await db.user.update({ where: { id: vendor.id }, data: { walletBalanceXMR: "0.1" } });
    const partial = () => requestWithdrawal(db, { userId: vendor.id, address: "test-address", pin: "123456", amount: "0.06" });
    const partials = await Promise.allSettled([partial(), partial()]);
    assert.equal(partials.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: vendor.id } })).walletBalanceXMR.toFixed(12), "0.040000000000");

    const product = await db.product.create({ data: {
      vendorId: vendor.id, title: "Integration test", description: "Integration test",
      priceXMR: "0.1", quantity: 1, category: "Tests", moderationStatus: "APPROVED",
    } });
    const reserve = () => db.$transaction(tx => reserveOrderResources(tx, { buyerId: buyer.id, productId: product.id, amount: "0.1" }));
    const orders = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(orders.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantity, 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: buyer.id } })).walletBalanceXMR.toFixed(12), "0.100000000000");
    await db.product.update({ where: { id: product.id }, data: { quantity: 1 } });
    await assert.rejects(db.$transaction(tx => reserveOrderResources(tx, { buyerId: buyer.id, productId: product.id, amount: "1" })), /InsufficientBalance/);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).quantity, 1);
    console.log("PASS: auth flow, challenge replay/expiry, treasury principal and fees, exact money, migration preservation, PIN, permissions, seed guards, concurrent requests/approvals/refunds, uncertain transfers, reconciliation, stock and balance reservations.");
  } finally {
    await client?.$disconnect();
    await pool?.end();
    if (created) await control.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await control.end();
  }
}

main().catch((error) => {
  // Never print connection strings or environment variables.
  console.error(error instanceof Error ? error.message : "Integration test failed");
  process.exitCode = 1;
});
