import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { atomicUnitsToXmr, getIncomingTransfersForSubaddresses } from "@/lib/monero-rpc";

const DEPOSIT_CONFIRMATIONS_REQUIRED = Number(process.env.XMR_DEPOSIT_CONFIRMATIONS || "10");

export async function syncIncomingDeposits(
  client: PrismaClient = prisma,
  readTransfers: typeof getIncomingTransfersForSubaddresses = getIncomingTransfersForSubaddresses,
) {
  return client.$transaction(async (lease) => {
    const [lock] = await lease.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(92745182) AS acquired`;
    if (!lock.acquired) return { scannedWallets: 0, transfers: 0, credited: 0, pending: 0, skipped: true };
    return syncDepositsWhileLocked(client, readTransfers);
  }, { timeout: 240000, maxWait: 5000 });
}

async function syncDepositsWhileLocked(client: PrismaClient, readTransfers: typeof getIncomingTransfersForSubaddresses) {
  const confirmationsRequired = Number.isSafeInteger(DEPOSIT_CONFIRMATIONS_REQUIRED) && DEPOSIT_CONFIRMATIONS_REQUIRED >= 1
    ? DEPOSIT_CONFIRMATIONS_REQUIRED
    : 10;

  const activeWallets = await client.transactionWallet.findMany({
    where: {
      purpose: "DEPOSIT",
      status: { in: ["ACTIVE", "USED"] },
      addressIndex: { not: null },
    },
    select: {
      id: true,
      userId: true,
      address: true,
      addressIndex: true,
      expectedAmountXMR: true,
    },
  });

  const addressIndexes = [...new Set(activeWallets.map((wallet) => wallet.addressIndex).filter((index): index is number => index !== null))];
  const walletByIndex = new Map(activeWallets.map((wallet) => [wallet.addressIndex, wallet]));
  const transfers = await readTransfers(addressIndexes);
  const credited: string[] = [];
  const pending: string[] = [];

  for (const transfer of transfers) {
    const txHash = transfer.txid || transfer.tx_hash;
    const addressIndex = transfer.subaddr_index?.minor;
    const wallet = addressIndex === undefined ? undefined : walletByIndex.get(addressIndex);
    const confirmations = Number(transfer.confirmations || 0);

    if (!txHash || !wallet) continue;
    if (transfer.unlocked === false || confirmations < confirmationsRequired) {
      pending.push(txHash);
      continue;
    }

    const amountXMR = atomicUnitsToXmr(transfer.amount);
    if (amountXMR.lte(0)) continue;

    try {
      await client.$transaction(async (tx) => {
        await tx.processedWalletPayment.create({
          data: {
            txHash,
            address: wallet.address,
            userId: wallet.userId,
            transactionWalletId: wallet.id,
            amountXMR,
            confirmations,
            status: "CREDITED",
          },
        });

        await tx.transactionWallet.update({
          where: { id: wallet.id },
          data: { status: "USED", usedAt: new Date() },
        });

        await tx.depositAddress.updateMany({
          where: { address: wallet.address, status: "ACTIVE" },
          data: { status: "USED" },
        });

        await tx.user.update({
          where: { id: wallet.userId },
          data: { walletBalanceXMR: { increment: amountXMR } },
        });

        await tx.platformWallet.upsert({
          where: { id: "market_wallet" },
          update: { balanceXMR: { increment: amountXMR } },
          create: { id: "market_wallet", balanceXMR: amountXMR, totalEarned: 0 },
        });

        await tx.financialLog.create({
          data: {
            type: "DEPOSIT",
            amountXMR,
            userId: wallet.userId,
            txHash,
            details: `Auto-scanned deposit credited. Address: ${wallet.address}. Confirmations: ${confirmations}.`,
          },
        });

        await tx.appEvent.create({
          data: {
            type: "wallet.deposit_credited",
            aggregate: "wallet",
            aggregateId: wallet.userId,
            actorId: null,
            payload: {
              txHash,
              address: wallet.address,
              amountXMR: amountXMR.toFixed(12),
              confirmations,
              expectedAmountXMR: wallet.expectedAmountXMR?.toFixed(12) ?? null,
            },
          },
        });
      });

      credited.push(txHash);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }
  }

  return {
    scannedWallets: activeWallets.length,
    transfers: transfers.length,
    credited: credited.length,
    pending: pending.length,
  };
}
