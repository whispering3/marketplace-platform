ALTER TABLE "MarketConfig" ALTER COLUMN "globalCommission" SET DEFAULT 0.04;

UPDATE "MarketConfig"
SET "globalCommission" = 0.04
WHERE "id" = 'global_config'
  AND "globalCommission" = 0.05;
