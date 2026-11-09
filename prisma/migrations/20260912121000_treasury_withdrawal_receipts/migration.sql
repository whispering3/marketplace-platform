ALTER TABLE "WithdrawalRequest" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "WithdrawalRequest" ADD COLUMN "networkFeeXMR" DECIMAL(30,12);
CREATE UNIQUE INDEX "WithdrawalRequest_sourceKey_key" ON "WithdrawalRequest"("sourceKey");
