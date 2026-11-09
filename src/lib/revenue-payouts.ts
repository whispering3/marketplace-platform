import type { Prisma } from "@prisma/client";
import { money, type MoneyInput } from "./money";

// Called inside the revenue transaction: reserve only the credited net revenue.
export async function queueRevenuePayout(tx: Prisma.TransactionClient, input: {
  userId: string; amount: MoneyInput; sourceKey: string; address?: string;
}) {
  if (!input.address) return null;
  const amount = money(input.amount);
  if (amount.lte(0)) return null;
  const reserved = await tx.user.updateMany({ where: {
    id: input.userId, isBanned: false, role: "ADMIN", walletBalanceXMR: { gte: amount },
  }, data: { walletBalanceXMR: { decrement: amount } } });
  if (reserved.count !== 1) throw new Error("RevenueReservationFailed");
  return tx.withdrawalRequest.create({ data: {
    userId: input.userId, address: input.address, amountXMR: amount, sourceKey: input.sourceKey,
  } });
}
