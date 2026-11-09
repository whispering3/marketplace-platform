CREATE TABLE "MarketCategory" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '[+]',
  "subcategories" TEXT[] NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketCategory_label_key" ON "MarketCategory"("label");
CREATE INDEX "MarketCategory_isActive_idx" ON "MarketCategory"("isActive");
