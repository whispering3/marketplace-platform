import { money, type MoneyInput } from "./money";
import type { Prisma } from "@prisma/client";

const PLATFORM_WALLET_ID = "market_wallet";
const AFFILIATE_COMMISSION_RATE = 0.1;

type RevenueSource = "ORDER_FEE" | "VENDOR_BOND" | "PROMOTION";

type CreditPlatformRevenueInput = {
  tx: Prisma.TransactionClient;
  amountXMR: MoneyInput;
  source: RevenueSource;
  orderId?: string;
  buyerId?: string;
};

export async function creditPlatformRevenue({
  tx,
  amountXMR,
  source,
  orderId,
  buyerId,
}: CreditPlatformRevenueInput) {
  amountXMR = money(amountXMR);
  if (amountXMR.lte(0)) return null;
  const affiliateCommissionXMR = await creditAffiliateCommission({
    tx,
    orderId,
    buyerId,
    marketFeeXMR: amountXMR,
  });
  const adminRevenueXMR = money(amountXMR).minus(affiliateCommissionXMR);

  await tx.platformWallet.upsert({
    where: { id: PLATFORM_WALLET_ID },
    update: {
      totalEarned: { increment: amountXMR },
    },
    create: {
      id: PLATFORM_WALLET_ID,
      balanceXMR: 0,
      totalEarned: amountXMR,
    },
  });

  const admin = await tx.user.findFirst({
    where: { role: "ADMIN", isBanned: false },
    orderBy: { joinDate: "asc" },
    select: { id: true },
  });

  if (!admin) throw new Error("RevenueAccountNotConfigured");

  if (adminRevenueXMR.gt(0)) {
    await tx.user.update({
      where: { id: admin.id },
      data: { walletBalanceXMR: { increment: adminRevenueXMR } },
    });
  }

  await tx.financialLog.create({
    data: {
      type: "ADMIN_REVENUE_CREDIT",
      amountXMR: adminRevenueXMR,
      userId: admin.id,
      orderId,
      details: `ADMIN_REVENUE_CREDIT: credited net revenue from ${source}. Gross fee ${amountXMR.toFixed(12)} XMR, affiliate ${affiliateCommissionXMR.toFixed(12)} XMR.`,
    },
  });

  return admin.id;
}

export async function creditPlatformRevenueFromEscrow({
  tx,
  amountXMR,
  orderId,
  buyerId,
}: Omit<CreditPlatformRevenueInput, "source">) {
  amountXMR = money(amountXMR);
  if (amountXMR.lte(0)) return null;
  const affiliateCommissionXMR = await creditAffiliateCommission({
    tx,
    orderId,
    buyerId,
    marketFeeXMR: amountXMR,
  });
  const adminRevenueXMR = money(amountXMR).minus(affiliateCommissionXMR);

  await tx.platformWallet.update({
    where: { id: PLATFORM_WALLET_ID },
    data: {
      totalEarned: { increment: amountXMR },
    },
  });

  const admin = await tx.user.findFirst({
    where: { role: "ADMIN", isBanned: false },
    orderBy: { joinDate: "asc" },
    select: { id: true },
  });

  if (!admin) throw new Error("RevenueAccountNotConfigured");

  if (adminRevenueXMR.gt(0)) {
    await tx.user.update({
      where: { id: admin.id },
      data: { walletBalanceXMR: { increment: adminRevenueXMR } },
    });
  }

  await tx.financialLog.create({
    data: {
      type: "ADMIN_REVENUE_CREDIT",
      amountXMR: adminRevenueXMR,
      userId: admin.id,
      orderId,
      details: `ADMIN_REVENUE_CREDIT: escrow fee credited net of affiliate commission. Gross fee ${amountXMR.toFixed(12)} XMR, affiliate ${affiliateCommissionXMR.toFixed(12)} XMR.`,
    },
  });

  return admin.id;
}

async function creditAffiliateCommission({
  tx,
  orderId,
  buyerId,
  marketFeeXMR,
}: {
  tx: Prisma.TransactionClient;
  orderId?: string;
  buyerId?: string;
  marketFeeXMR: MoneyInput;
}) {
  if (!orderId || !buyerId || money(marketFeeXMR).lte(0)) {
    return 0;
  }

  const buyer = await tx.user.findUnique({
    where: { id: buyerId },
    select: { referredById: true },
  });

  const referrerId = buyer?.referredById;
  if (!referrerId || referrerId === buyerId) return 0;

  const referrer = await tx.user.findUnique({
    where: { id: referrerId },
    select: { id: true, isBanned: true },
  });
  if (!referrer || referrer.isBanned) return 0;

  const commissionXMR = money(money(marketFeeXMR).mul(AFFILIATE_COMMISSION_RATE));
  if (commissionXMR.lte(0)) return 0;

  await tx.affiliateCommission.create({
      data: {
        orderId,
        referrerId,
        referredUserId: buyerId,
        marketFeeXMR,
        commissionXMR,
        rate: AFFILIATE_COMMISSION_RATE,
        status: "CREDITED",
      },
    });

  await tx.user.update({
    where: { id: referrerId },
    data: { walletBalanceXMR: { increment: commissionXMR } },
  });

  await tx.financialLog.create({
    data: {
      type: "AFFILIATE_COMMISSION",
      amountXMR: commissionXMR,
      userId: referrerId,
      orderId,
      details: `Affiliate commission credited at ${(AFFILIATE_COMMISSION_RATE * 100).toFixed(0)}% of market fee.`,
    },
  });

  return commissionXMR;
}
