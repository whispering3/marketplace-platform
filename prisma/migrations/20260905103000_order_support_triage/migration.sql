-- Add order-linked support/dispute participants.
ALTER TABLE "SupportTicket" ADD COLUMN "orderId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "buyerId" TEXT;
ALTER TABLE "SupportTicket" ADD COLUMN "vendorId" TEXT;

-- Backfill participant data for existing tickets already attached via Order.disputeTicketId.
UPDATE "SupportTicket" st
SET
  "orderId" = o."id",
  "buyerId" = o."buyerId",
  "vendorId" = o."vendorId"
FROM "Order" o
WHERE o."disputeTicketId" = st."id";

CREATE UNIQUE INDEX "SupportTicket_orderId_key" ON "SupportTicket"("orderId");
CREATE INDEX "SupportTicket_buyerId_idx" ON "SupportTicket"("buyerId");
CREATE INDEX "SupportTicket_vendorId_idx" ON "SupportTicket"("vendorId");
CREATE INDEX "SupportTicket_category_status_idx" ON "SupportTicket"("category", "status");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
