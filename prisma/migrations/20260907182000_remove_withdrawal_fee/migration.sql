ALTER TABLE "WithdrawalRequest" ALTER COLUMN "feeXMR" SET DEFAULT 0;

UPDATE "WithdrawalRequest"
SET "feeXMR" = 0
WHERE "status" = 'AWAITING_APPROVAL';
