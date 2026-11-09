ALTER TABLE "TransactionWallet" ADD COLUMN "addressIndex" INTEGER;
ALTER TABLE "DepositAddress" ADD COLUMN "addressIndex" INTEGER;

CREATE TABLE "ProcessedWalletPayment" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionWalletId" TEXT,
    "amountXMR" DOUBLE PRECISION NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CREDITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedWalletPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessedWalletPayment_txHash_address_key" ON "ProcessedWalletPayment"("txHash", "address");
CREATE INDEX "ProcessedWalletPayment_userId_idx" ON "ProcessedWalletPayment"("userId");
CREATE INDEX "ProcessedWalletPayment_transactionWalletId_idx" ON "ProcessedWalletPayment"("transactionWalletId");
CREATE INDEX "ProcessedWalletPayment_createdAt_idx" ON "ProcessedWalletPayment"("createdAt");
CREATE INDEX "TransactionWallet_addressIndex_idx" ON "TransactionWallet"("addressIndex");
CREATE INDEX "DepositAddress_addressIndex_idx" ON "DepositAddress"("addressIndex");

ALTER TABLE "ProcessedWalletPayment" ADD CONSTRAINT "ProcessedWalletPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcessedWalletPayment" ADD CONSTRAINT "ProcessedWalletPayment_transactionWalletId_fkey" FOREIGN KEY ("transactionWalletId") REFERENCES "TransactionWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
