import type { Prisma, PrismaClient } from "@prisma/client";
import { verifyPin } from "./pin";
import { hasStaffPermission } from "./staff-permissions";
import { money, toPiconero, type MoneyInput } from "./money";

type Transfer = (address: string, amount: MoneyInput) => Promise<string | { txHash: string; networkFeeXMR: MoneyInput }>;
const hashPattern = /^[a-f0-9]{64}$/i;

async function authorize(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!hasStaffPermission(actor, "wallets")) throw new Error("UnauthorizedWalletOperation");
  return actor!;
}

export async function requestWithdrawal(
  client: PrismaClient,
  input: { userId: string; address: string; pin: string; amount?: MoneyInput },
) {
  if (!input.address.trim()) throw new Error("MissingAddress");
  return client.$transaction(async (tx) => {
    // Serialize balance reservations, including simultaneous requests from the same user.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.isBanned || user.role !== "VENDOR") throw new Error("WithdrawalNotAllowed");
    if (!verifyPin(input.pin, user.pin)) throw new Error("InvalidPIN");
    const amount = input.amount === undefined ? user.walletBalanceXMR : money(input.amount);
    if (amount.lte(0) || user.walletBalanceXMR.lt(amount)) throw new Error("InsufficientBalance");
    if (toPiconero(amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("UnsafeTransferAmount");

    const request = await tx.withdrawalRequest.create({
      data: { userId: user.id, address: input.address, amountXMR: amount, feeXMR: 0 },
    });
    await tx.user.update({ where: { id: user.id }, data: { walletBalanceXMR: { decrement: amount } } });
    await tx.appEvent.create({ data: {
      type: "wallet.withdrawal_requested", aggregate: "wallet", aggregateId: request.id,
      actorId: user.id, payload: { amountXMR: amount.toFixed(12), feeXMR: "0" },
    } });
    return request;
  });
}

async function finishWithdrawal(client: PrismaClient, requestId: string, txHash: string) {
  return client.$transaction(async (tx) => {
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id: requestId, status: { in: ["PROCESSING", "NEEDS_REVIEW"] }, txHash },
      data: { status: "COMPLETED", processedAt: new Date(), failureCode: null },
    });
    if (claimed.count !== 1) throw new Error("InvalidRequestState");
    const request = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
    await tx.platformWallet.upsert({
      where: { id: "market_wallet" },
      update: { balanceXMR: { decrement: request.amountXMR.plus(request.networkFeeXMR || 0) } },
      create: { id: "market_wallet", balanceXMR: request.amountXMR.plus(request.networkFeeXMR || 0).negated() },
    });
    await tx.platformFinance.upsert({
      where: { id: "treasury" },
      update: request.sourceKey
        ? { totalBondsSiphoned: { increment: request.amountXMR } }
        : { totalWithdrawalsProcessed: { increment: request.amountXMR } },
      create: { id: "treasury", totalWithdrawalsProcessed: request.sourceKey ? 0 : request.amountXMR, totalBondsSiphoned: request.sourceKey ? request.amountXMR : 0 },
    });
    await tx.financialLog.create({ data: {
      type: request.sourceKey ? "SIPHON" : "WITHDRAWAL", amountXMR: request.amountXMR, userId: request.userId,
      txHash, details: request.sourceKey ? `Revenue payout ${request.sourceKey} completed via withdrawal ${requestId}.` : `Withdrawal ${requestId} completed. No platform withdrawal fee.`,
    } });
    await tx.adminAuditLog.create({ data: {
      actorId: request.processedById, action: "WITHDRAWAL_COMPLETED",
      target: "WithdrawalRequest", targetId: requestId, details: txHash,
    } });
    return request;
  });
}

export async function reviewWithdrawal(
  client: PrismaClient,
  input: { actorId: string; requestId: string; decision: string },
  transfer: Transfer,
) {
  if (!["APPROVE", "REJECT"].includes(input.decision)) throw new Error("InvalidWithdrawalDecision");
  const request = await client.$transaction(async (tx) => {
    const actor = await authorize(tx, input.actorId);
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id: input.requestId, status: "AWAITING_APPROVAL" },
      data: {
        status: input.decision === "APPROVE" ? "PROCESSING" : "REJECTED",
        processedById: actor.id, processingStartedAt: new Date(),
        processedAt: input.decision === "REJECT" ? new Date() : null,
      },
    });
    if (claimed.count !== 1) throw new Error("InvalidRequestState");
    const row = await tx.withdrawalRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    if (input.decision === "REJECT") {
      const refund = row.amountXMR.plus(row.feeXMR);
      await tx.user.update({ where: { id: row.userId }, data: { walletBalanceXMR: { increment: refund } } });
      await tx.financialLog.create({ data: {
        type: "REFUND", amountXMR: refund, userId: row.userId,
        details: `Withdrawal ${row.id} rejected. Reserved balance returned.`,
      } });
    }
    await tx.adminAuditLog.create({ data: {
      actorId: actor.id, actorName: actor.username,
      action: input.decision === "APPROVE" ? "WITHDRAWAL_PROCESSING" : "WITHDRAWAL_REJECTED",
      target: "WithdrawalRequest", targetId: row.id,
    } });
    return row;
  });
  if (input.decision === "REJECT") return request;

  let txHash: string | undefined;
  let networkFeeXMR: ReturnType<typeof money> | undefined;
  try {
    const receipt = await transfer(request.address, request.amountXMR);
    txHash = typeof receipt === "string" ? receipt : receipt.txHash;
    networkFeeXMR = money(typeof receipt === "string" ? 0 : receipt.networkFeeXMR);
    if (networkFeeXMR.lt(0)) throw new Error("InvalidNetworkFee");
    if (!hashPattern.test(txHash)) throw new Error("InvalidTransferResponse");
    // Save the receipt independently: an accounting rollback must not erase it.
    await client.withdrawalRequest.update({ where: { id: request.id }, data: { txHash, networkFeeXMR } });
    return await finishWithdrawal(client, request.id, txHash);
  } catch {
    // A timeout does not prove the transfer failed. Never automatically send or refund again.
    await client.withdrawalRequest.updateMany({
      where: { id: request.id, status: "PROCESSING" },
      data: {
        status: "NEEDS_REVIEW", failureCode: "TRANSFER_REQUIRES_RECONCILIATION",
        ...(txHash && hashPattern.test(txHash) ? { txHash, ...(networkFeeXMR?.gte(0) ? { networkFeeXMR } : {}) } : {}),
      },
    }).catch(() => undefined); // PROCESSING is also locked if the database is unavailable.
    throw new Error("WithdrawalNeedsReview");
  }
}

export async function reconcileWithdrawal(
  client: PrismaClient,
  input: { actorId: string; requestId: string; txHash: string },
  verifyTransfer: (hash: string, address: string, amount: MoneyInput) => Promise<boolean | { networkFeeXMR: MoneyInput }>,
) {
  if (!hashPattern.test(input.txHash)) throw new Error("InvalidTransactionHash");
  const request = await client.$transaction(async (tx) => {
    await authorize(tx, input.actorId);
    return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: input.requestId } });
  });
  if (!["PROCESSING", "NEEDS_REVIEW"].includes(request.status)) throw new Error("InvalidRequestState");
  if (request.txHash && request.txHash !== input.txHash) throw new Error("TransactionHashMismatch");
  // Do not race an in-flight transfer; only recover PROCESSING after its RPC deadline.
  if (request.status === "PROCESSING" && request.processingStartedAt && Date.now() - request.processingStartedAt.getTime() < 300_000) {
    throw new Error("WithdrawalStillProcessing");
  }
  const receipt = await verifyTransfer(input.txHash, request.address, request.amountXMR);
  if (!receipt) throw new Error("TransferNotVerified");
  const networkFeeXMR = money(typeof receipt === "boolean" ? request.networkFeeXMR || 0 : receipt.networkFeeXMR);
  if (networkFeeXMR.lt(0)) throw new Error("InvalidNetworkFee");
  await client.$transaction(async (tx) => {
    await authorize(tx, input.actorId);
    const claimed = await tx.withdrawalRequest.updateMany({
      where: { id: request.id, status: { in: ["PROCESSING", "NEEDS_REVIEW"] }, OR: [{ txHash: null }, { txHash: input.txHash }] },
      data: { txHash: input.txHash, networkFeeXMR },
    });
    if (claimed.count !== 1) throw new Error("InvalidRequestState");
    await tx.adminAuditLog.create({ data: {
      actorId: input.actorId, action: "WITHDRAWAL_RECONCILED", target: "WithdrawalRequest",
      targetId: request.id, details: input.txHash,
    } });
  });
  return finishWithdrawal(client, request.id, input.txHash);
}
