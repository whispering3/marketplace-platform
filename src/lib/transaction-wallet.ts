import "server-only";
import type { MoneyInput } from "./money";
import { prisma } from "./db";
import { createSubaddress } from "./monero-rpc";

export async function createTransactionWallet(input: {
  userId: string;
  purpose: "DEPOSIT" | "ORDER" | "ESCROW";
  referenceId?: string | null;
  expectedAmountXMR?: MoneyInput | null;
}) {
  const subaddress = await createSubaddress(`${input.purpose.toLowerCase()}_${input.userId}_${Date.now()}`);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const wallet = await prisma.transactionWallet.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      referenceId: input.referenceId || null,
      expectedAmountXMR: input.expectedAmountXMR || null,
      address: subaddress.address,
      addressIndex: subaddress.addressIndex,
      expiresAt,
    },
  });

  return wallet;
}
