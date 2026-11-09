import type { Prisma } from "@prisma/client";
import { money, type MoneyInput } from "./money";

/** Must run inside the same transaction as order creation and vendor settlement. */
export async function reserveOrderResources(
  tx: Prisma.TransactionClient,
  input: { buyerId: string; productId: string; amount: MoneyInput },
) {
  const amount = money(input.amount);
  if (amount.lte(0)) throw new Error("InvalidOrderAmount");
  const stock = await tx.product.updateMany({
    where: {
      id: input.productId, quantity: { gt: 0 }, isPaused: false,
      moderationStatus: "APPROVED", vendorId: { not: input.buyerId },
      vendor: { isBanned: false, isVacationMode: false },
    },
    data: { quantity: { decrement: 1 } },
  });
  if (stock.count !== 1) throw new Error("ProductUnavailable");
  const balance = await tx.user.updateMany({
    where: { id: input.buyerId, isBanned: false, walletBalanceXMR: { gte: amount } },
    data: { walletBalanceXMR: { decrement: amount } },
  });
  if (balance.count !== 1) throw new Error("InsufficientBalance");
}
