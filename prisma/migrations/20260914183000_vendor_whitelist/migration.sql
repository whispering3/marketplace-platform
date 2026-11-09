CREATE TABLE "VendorWhitelistEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorWhitelistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VendorWhitelistEntry_vendorId_buyerId_key" ON "VendorWhitelistEntry"("vendorId", "buyerId");
CREATE INDEX "VendorWhitelistEntry_vendorId_createdAt_idx" ON "VendorWhitelistEntry"("vendorId", "createdAt");
CREATE INDEX "VendorWhitelistEntry_buyerId_idx" ON "VendorWhitelistEntry"("buyerId");

ALTER TABLE "VendorWhitelistEntry"
ADD CONSTRAINT "VendorWhitelistEntry_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorWhitelistEntry"
ADD CONSTRAINT "VendorWhitelistEntry_buyerId_fkey"
FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
