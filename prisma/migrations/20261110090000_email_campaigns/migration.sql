-- Automated email to students: good-morning message, order reminder, admin announcements and order updates.
--
-- Additive only: two enums and four new tables. No existing table, column or row is changed, so code from before
-- this migration keeps working, and the email code runs on a database without it (no automated email is sent, the
-- admin page explains, and settings show the old notification text).
--   * EmailPreference: a student's choices per kind. No row = everything on (owner's choice: on by default, with a
--     one-tap unsubscribe link in every email and switches in Settings).
--   * EmailSchedule: admin on/off per kind. Seeded below: MORNING and REMINDER OFF (an admin sends a test, then turns
--     them on), ORDER_UPDATE ON. Announcements are sent one at a time by an admin and need no switch.
--   * EmailBroadcast: announcements admins write.
--   * EmailDelivery: one row per email per student; unique (userId, kind, key) so nothing is ever sent twice.
--
-- Explicit transaction: Prisma does not wrap a migration file in one, and the seed must never land partially.
-- lock_timeout: the foreign keys briefly lock "User"; fail fast (and retry later) rather than queue behind a long
-- transaction and hold up sign-ins.
--
-- Rollback (stops all automated email; nothing else depends on these tables):
--   DROP TABLE "EmailDelivery"; DROP TABLE "EmailBroadcast"; DROP TABLE "EmailSchedule"; DROP TABLE "EmailPreference";
--   DROP TYPE "EmailDeliveryStatus"; DROP TYPE "EmailKind";
BEGIN;

SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('MORNING', 'REMINDER', 'ANNOUNCEMENT', 'ORDER_UPDATE');
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "EmailPreference" (
    "userId" TEXT NOT NULL,
    "morning" BOOLEAN NOT NULL DEFAULT true,
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "announcements" BOOLEAN NOT NULL DEFAULT true,
    "orderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EmailSchedule" (
    "kind" "EmailKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "EmailSchedule_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "EmailBroadcast" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonLabel" TEXT,
    "buttonUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "EmailBroadcast_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailBroadcast_status_check" CHECK ("status" IN ('SENDING', 'SENT', 'CANCELLED')),
    CONSTRAINT "EmailBroadcast_subject_check" CHECK (char_length("subject") BETWEEN 1 AND 120),
    CONSTRAINT "EmailBroadcast_body_check" CHECK (char_length("body") BETWEEN 1 AND 5000),
    -- A button needs both a label and a link.
    CONSTRAINT "EmailBroadcast_button_check" CHECK (("buttonLabel" IS NULL) = ("buttonUrl" IS NULL)),
    CONSTRAINT "EmailBroadcast_recipients_check" CHECK ("recipientCount" >= 0)
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "key" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailDelivery_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateIndex: the admin list of announcements.
CREATE INDEX "EmailBroadcast_status_createdAt_idx" ON "EmailBroadcast"("status", "createdAt");

-- CreateIndex: claiming the next batch of one send, and counting its progress.
CREATE INDEX "EmailDelivery_kind_key_status_idx" ON "EmailDelivery"("kind", "key", "status");

-- CreateIndex: finding stuck and expired rows.
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");

-- CreateIndex: each email at most once per student.
CREATE UNIQUE INDEX "EmailDelivery_userId_kind_key_key" ON "EmailDelivery"("userId", "kind", "key");

-- AddForeignKey: preferences and deliveries go with the account; switches and announcements keep their admin.
ALTER TABLE "EmailPreference" ADD CONSTRAINT "EmailPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailSchedule" ADD CONSTRAINT "EmailSchedule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmailBroadcast" ADD CONSTRAINT "EmailBroadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the scheduled emails start OFF; order updates start ON. UTC timestamps, as Prisma writes them.
INSERT INTO "EmailSchedule" ("kind", "enabled", "updatedAt") VALUES
    ('MORNING', false, (now() AT TIME ZONE 'UTC')),
    ('REMINDER', false, (now() AT TIME ZONE 'UTC')),
    ('ORDER_UPDATE', true, (now() AT TIME ZONE 'UTC'));

COMMIT;
