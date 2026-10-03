-- Idempotent notification delivery and audited support operations.
ALTER TABLE "Notification" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN "relatedType" TEXT;
ALTER TABLE "Notification" ADD COLUMN "relatedId" TEXT;
CREATE UNIQUE INDEX "Notification_userId_idempotencyKey_key" ON "Notification"("userId", "idempotencyKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

ALTER TABLE "SupportCase" ADD COLUMN "resolution" TEXT;
ALTER TABLE "SupportCase" ADD COLUMN "handledById" TEXT;
CREATE INDEX "SupportCase_orderId_idx" ON "SupportCase"("orderId");
CREATE INDEX "SupportCase_handledById_idx" ON "SupportCase"("handledById");
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "previousState" JSONB,
  "newState" JSONB,
  "details" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_resource_resourceId_createdAt_idx" ON "AuditLog"("resource", "resourceId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TYPE "SupportCaseStatus" ADD VALUE 'ESCALATED';
ALTER TABLE "Incident" ADD COLUMN "resolution" TEXT;

CREATE TABLE "RateLimitBucket" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RateLimitBucket_key_windowStart_key" ON "RateLimitBucket"("key", "windowStart");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
