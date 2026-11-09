ALTER TABLE "Announcement" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Announcement" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Announcement_isActive_expiresAt_idx" ON "Announcement"("isActive", "expiresAt");
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");
