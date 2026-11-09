import "server-only";
import { prisma } from "@/lib/db";
import { transferWithReceipt } from "@/lib/monero-rpc";
import { reviewWithdrawal } from "@/lib/withdrawals";
import { syncIncomingDeposits } from "@/lib/wallet-sync";

export async function triggerAutoSiphon(requestId: string | undefined) {
  if (!requestId) return;
  const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
  if (!request?.sourceKey || request.status !== "AWAITING_APPROVAL") return;
  try {
    await reviewWithdrawal(prisma, { actorId: request.userId, requestId, decision: "APPROVE" }, transferWithReceipt);
  } catch {
    // The durable withdrawal remains available for staff review; never retry a transfer here.
    console.error("[REVENUE_PAYOUT_REQUIRES_REVIEW]", requestId);
  }
}

export async function syncIncomingDepositsAction() { return syncIncomingDeposits(); }
