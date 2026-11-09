ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "staffPermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "moderationStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "moderationNote" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "moderatedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "moderatedById" TEXT;

CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "action" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "targetId" TEXT,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Product_moderationStatus_idx" ON "Product"("moderationStatus");
CREATE INDEX IF NOT EXISTS "Product_moderationStatus_createdAt_idx" ON "Product"("moderationStatus", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorId_idx" ON "AdminAuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_target_targetId_idx" ON "AdminAuditLog"("target", "targetId");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
