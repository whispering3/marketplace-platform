CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "marketFeeXMR" DOUBLE PRECISION NOT NULL,
    "commissionXMR" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "status" TEXT NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateCommission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffiliateCommission_orderId_key" ON "AffiliateCommission"("orderId");
CREATE INDEX "AffiliateCommission_referrerId_idx" ON "AffiliateCommission"("referrerId");
CREATE INDEX "AffiliateCommission_referredUserId_idx" ON "AffiliateCommission"("referredUserId");
CREATE INDEX "AffiliateCommission_createdAt_idx" ON "AffiliateCommission"("createdAt");
CREATE INDEX "AffiliateCommission_status_idx" ON "AffiliateCommission"("status");
