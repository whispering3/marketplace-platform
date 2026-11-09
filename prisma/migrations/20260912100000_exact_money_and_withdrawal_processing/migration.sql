BEGIN;

CREATE TABLE "MonetaryMigrationSnapshot" (
  "tableName" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonetaryMigrationSnapshot_pkey" PRIMARY KEY ("tableName", "recordId")
);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'User', "id", jsonb_build_object('walletBalanceXMR', "walletBalanceXMR"::text) FROM "User";

ALTER TABLE "User" ALTER COLUMN "walletBalanceXMR" TYPE DECIMAL(30,12) USING ROUND("walletBalanceXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'AffiliateCommission', "id", jsonb_build_object('marketFeeXMR', "marketFeeXMR"::text, 'commissionXMR', "commissionXMR"::text) FROM "AffiliateCommission";

ALTER TABLE "AffiliateCommission" ALTER COLUMN "marketFeeXMR" TYPE DECIMAL(30,12) USING ROUND("marketFeeXMR"::numeric, 12);

ALTER TABLE "AffiliateCommission" ALTER COLUMN "commissionXMR" TYPE DECIMAL(30,12) USING ROUND("commissionXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'TransactionWallet', "id", jsonb_build_object('expectedAmountXMR', "expectedAmountXMR"::text) FROM "TransactionWallet";

ALTER TABLE "TransactionWallet" ALTER COLUMN "expectedAmountXMR" TYPE DECIMAL(30,12) USING ROUND("expectedAmountXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'ProcessedWalletPayment', "id", jsonb_build_object('amountXMR', "amountXMR"::text) FROM "ProcessedWalletPayment";

ALTER TABLE "ProcessedWalletPayment" ALTER COLUMN "amountXMR" TYPE DECIMAL(30,12) USING ROUND("amountXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'Product', "id", jsonb_build_object('priceXMR', "priceXMR"::text) FROM "Product";

ALTER TABLE "Product" ALTER COLUMN "priceXMR" TYPE DECIMAL(30,12) USING ROUND("priceXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'ShippingOption', "id", jsonb_build_object('costXMR', "costXMR"::text) FROM "ShippingOption";

ALTER TABLE "ShippingOption" ALTER COLUMN "costXMR" TYPE DECIMAL(30,12) USING ROUND("costXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'Order', "id", jsonb_build_object('totalXMR', "totalXMR"::text, 'marketFeeXMR', "marketFeeXMR"::text, 'shippingCostXMR', "shippingCostXMR"::text) FROM "Order";

ALTER TABLE "Order" ALTER COLUMN "totalXMR" TYPE DECIMAL(30,12) USING ROUND("totalXMR"::numeric, 12);

ALTER TABLE "Order" ALTER COLUMN "marketFeeXMR" TYPE DECIMAL(30,12) USING ROUND("marketFeeXMR"::numeric, 12);

ALTER TABLE "Order" ALTER COLUMN "shippingCostXMR" TYPE DECIMAL(30,12) USING ROUND("shippingCostXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'WithdrawalRequest', "id", jsonb_build_object('amountXMR', "amountXMR"::text, 'feeXMR', "feeXMR"::text) FROM "WithdrawalRequest";

ALTER TABLE "WithdrawalRequest" ALTER COLUMN "amountXMR" TYPE DECIMAL(30,12) USING ROUND("amountXMR"::numeric, 12);

ALTER TABLE "WithdrawalRequest" ALTER COLUMN "feeXMR" TYPE DECIMAL(30,12) USING ROUND("feeXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'PlatformWallet', "id", jsonb_build_object('balanceXMR', "balanceXMR"::text, 'totalEarned', "totalEarned"::text, 'escrowTotal', "escrowTotal"::text) FROM "PlatformWallet";

ALTER TABLE "PlatformWallet" ALTER COLUMN "balanceXMR" TYPE DECIMAL(30,12) USING ROUND("balanceXMR"::numeric, 12);

ALTER TABLE "PlatformWallet" ALTER COLUMN "totalEarned" TYPE DECIMAL(30,12) USING ROUND("totalEarned"::numeric, 12);

ALTER TABLE "PlatformWallet" ALTER COLUMN "escrowTotal" TYPE DECIMAL(30,12) USING ROUND("escrowTotal"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'PlatformFinance', "id", jsonb_build_object('totalFeesSiphoned', "totalFeesSiphoned"::text, 'totalBondsSiphoned', "totalBondsSiphoned"::text, 'totalWithdrawalsProcessed', "totalWithdrawalsProcessed"::text) FROM "PlatformFinance";

ALTER TABLE "PlatformFinance" ALTER COLUMN "totalFeesSiphoned" TYPE DECIMAL(30,12) USING ROUND("totalFeesSiphoned"::numeric, 12);

ALTER TABLE "PlatformFinance" ALTER COLUMN "totalBondsSiphoned" TYPE DECIMAL(30,12) USING ROUND("totalBondsSiphoned"::numeric, 12);

ALTER TABLE "PlatformFinance" ALTER COLUMN "totalWithdrawalsProcessed" TYPE DECIMAL(30,12) USING ROUND("totalWithdrawalsProcessed"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'MarketConfig', "id", jsonb_build_object('minWithdrawalXMR', "minWithdrawalXMR"::text) FROM "MarketConfig";

ALTER TABLE "MarketConfig" ALTER COLUMN "minWithdrawalXMR" TYPE DECIMAL(30,12) USING ROUND("minWithdrawalXMR"::numeric, 12);

INSERT INTO "MonetaryMigrationSnapshot" ("tableName", "recordId", "values")
SELECT 'FinancialLog', "id", jsonb_build_object('amountXMR', "amountXMR"::text) FROM "FinancialLog";

ALTER TABLE "FinancialLog" ALTER COLUMN "amountXMR" TYPE DECIMAL(30,12) USING ROUND("amountXMR"::numeric, 12);

ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "processedById" TEXT,
  ADD COLUMN "failureCode" TEXT;
CREATE UNIQUE INDEX "WithdrawalRequest_txHash_key" ON "WithdrawalRequest"("txHash");
COMMIT;
