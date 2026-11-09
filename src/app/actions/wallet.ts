"use server";

import { prisma } from "@/lib/db";
import { verifyAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { transferWithReceipt, validateMoneroAddress } from "@/lib/monero-rpc";
import { requestWithdrawal, reviewWithdrawal } from "@/lib/withdrawals";
import { parseMoney } from "@/lib/money";
import { verifyPin } from "@/lib/pin";
import { publishEvent } from "@/lib/events";
import { createTransactionWallet } from "@/lib/transaction-wallet";
import { syncIncomingDeposits } from "@/lib/wallet-sync";

/**
 * GENERATE UNIQUE DEPOSIT ADDRESS
 * Requirement: generate a distinct address for each deposit request
 */
export async function generateDepositAddressAction(formData: FormData) {
  const session = await verifyAuth();
  const pin = formData.get("pin")?.toString();
  let expectedAmount;
  try { expectedAmount = parseMoney(formData.get("expected_amount")?.toString() || "0"); }
  catch { return redirect("/market/wallet?error=InvalidAmount"); }
  if (expectedAmount.lt(0)) return redirect("/market/wallet?error=InvalidAmount");

  if (!session || !session.userId) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({ where: { id: session.userId as string } });
  if (!verifyPin(pin, user?.pin)) return redirect("/market/wallet?error=InvalidPIN");

  let realAddress;
  let addressIndex: number | null = null;
  try {
    const wallet = await createTransactionWallet({
      userId: session.userId as string,
      purpose: "DEPOSIT",
      expectedAmountXMR: expectedAmount.gt(0) ? expectedAmount : null,
    });
    realAddress = wallet.address;
    addressIndex = wallet.addressIndex;
  } catch (error: any) {
    console.error("Monero Node Offline:", error.message);
    // In production, if the Daemon goes offline, we prevent creation to avoid panic.
    return redirect("/market/wallet?error=MoneroConnectionRefused");
  }

  await prisma.depositAddress.create({
    data: {
      userId: session.userId as string,
      address: realAddress,
      addressIndex,
      status: "ACTIVE"
    }
  });

  await publishEvent({
    type: "wallet.deposit_address_created",
    aggregate: "wallet",
    aggregateId: session.userId as string,
    actorId: session.userId as string,
    payload: { expectedAmountXMR: expectedAmount.gt(0) ? expectedAmount.toFixed(12) : null },
  });

  revalidatePath("/market/wallet");
}

/**
 * Internal deposits are intentionally disabled in production.
 * Real user credits must come from syncIncomingDeposits(), which verifies
 * confirmed Monero transfers from wallet-rpc and records each tx once.
 */
export async function processInternalDeposit() {
  return redirect("/market/wallet?error=InternalDepositsDisabled");
}

/**
 * SYSTEM: SCAN LIVE MONERO DEPOSITS
 * Credits each on-chain payment once after the configured confirmation threshold.
 */
export async function syncIncomingDepositsAction() {
  const session = await verifyAuth();
  const user = await prisma.user.findUnique({
    where: { id: session.userId as string },
    select: { role: true },
  });
  if (user?.role !== "ADMIN") {
    throw new Error("UnauthorizedWalletSync");
  }

  const result = await syncIncomingDeposits();
  if (result.credited > 0) revalidatePath("/market/wallet");
  return result;
}

/**
 * REQUEST WITHDRAWAL (VENDOR/BUYER)
 */
export async function requestWithdrawAction(formData: FormData) {
  const session = await verifyAuth();
  const address = formData.get("withdraw_addr")?.toString();
  const pin = formData.get("pin")?.toString();

  if (!address || !pin) return redirect("/market/wallet?error=MissingData");
  const isValidAddress = await validateMoneroAddress(address).catch(() => false);
  if (!isValidAddress) return redirect("/market/wallet?error=InvalidMoneroAddress");

  try {
    const rawAmount = formData.get("amount")?.toString().trim();
    await requestWithdrawal(prisma, { userId: session.userId, address, pin, amount: rawAmount ? parseMoney(rawAmount) : undefined });
  } catch (error) {
    const code = error instanceof Error ? error.message : "WithdrawalFailed";
    return redirect(`/market/wallet?error=${encodeURIComponent(code)}`);
  }
  return redirect("/market/wallet?success=WithdrawalAwaitingApproval");
}

export async function adminProcessWithdrawAction(formData: FormData) {
  const session = await verifyAuth();
  const admin = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!session.isStaffVerified || !admin || admin.isBanned || admin.role !== "ADMIN") throw new Error("UnauthorizedGovernance");
  await reviewWithdrawal(prisma, {
    actorId: session.userId,
    requestId: formData.get("requestId")?.toString() || "",
    decision: formData.get("decision")?.toString() || "",
  }, transferWithReceipt);
  revalidatePath("/staff-vault");
  revalidatePath("/market/wallet");
}
