import "dotenv/config";
import { prisma } from "../src/lib/db";
import { callRpc } from "../src/lib/monero-rpc";
import { atomicUnitsToXmr, money } from "../src/lib/money";

async function main() {
  const snapshot = await prisma.$transaction(async (tx) => {
    const [wallet, users, reserved, escrow] = await Promise.all([
      tx.platformWallet.findUnique({ where: { id: "market_wallet" } }),
      tx.user.aggregate({ _sum: { walletBalanceXMR: true } }),
      tx.withdrawalRequest.aggregate({ where: { status: { in: ["AWAITING_APPROVAL", "PROCESSING", "NEEDS_REVIEW"] } }, _sum: { amountXMR: true, feeXMR: true } }),
      tx.order.aggregate({ where: { paymentConfirmed: true, status: { in: ["PENDING", "SHIPPED", "DISPUTE"] } }, _sum: { totalXMR: true } }),
    ]);
    const liabilities = money(users._sum.walletBalanceXMR || 0).plus(reserved._sum.amountXMR || 0).plus(reserved._sum.feeXMR || 0).plus(escrow._sum.totalXMR || 0);
    return { ledger: money(wallet?.balanceXMR || 0), liabilities, escrowDifference: money(wallet?.escrowTotal || 0).minus(escrow._sum.totalXMR || 0) };
  }, { isolationLevel: "RepeatableRead" });
  const balance = await callRpc("get_balance", { account_index: 0 });
  const chain = atomicUnitsToXmr(balance.balance);
  const unlocked = atomicUnitsToXmr(balance.unlocked_balance);
  const difference = chain.minus(snapshot.ledger);
  const ok = difference.eq(0) && snapshot.escrowDifference.eq(0) && chain.gte(snapshot.liabilities);
  console.log(JSON.stringify({
    ok, recordedAt: new Date().toISOString(), ledgerXMR: snapshot.ledger.toFixed(12), walletRpcXMR: chain.toFixed(12),
    unlockedXMR: unlocked.toFixed(12), liabilitiesXMR: snapshot.liabilities.toFixed(12),
    walletDifferenceXMR: difference.toFixed(12), escrowDifferenceXMR: snapshot.escrowDifference.toFixed(12),
    note: "Read only. Investigate differences: pending deposits, historical fees, external movements or concurrent changes between snapshots. Never adjust balances automatically.",
  }, null, 2));
  if (!ok) process.exitCode = 1;
}
main().catch(() => { console.error("Reconciliation unavailable. Check database and RPC."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
