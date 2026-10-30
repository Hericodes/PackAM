-- Admin analytics: anonymous page views, plus two indexes for dashboard queries on existing tables.
--
-- Additive only: one new table and two new indexes. No existing table, column or row is changed.
-- No personal data: visitorId and sessionId are random ids made in the visitor's browser; no account, IP
-- address, user agent or query string is stored.
--
-- Rollback: DROP TABLE "PageView"; DROP INDEX "User_role_createdAt_idx"; DROP INDEX "Payment_status_paidAt_idx";

CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrerHost" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PageView_sizes_check" CHECK (
      length("viewId") BETWEEN 1 AND 64 AND length("visitorId") BETWEEN 1 AND 64 AND length("sessionId") BETWEEN 1 AND 64
      AND length("path") BETWEEN 1 AND 300 AND ("referrerHost" IS NULL OR length("referrerHost") <= 255)
    )
);
CREATE UNIQUE INDEX "PageView_viewId_key" ON "PageView"("viewId");
CREATE INDEX "PageView_createdAt_idx" ON "PageView"("createdAt");
CREATE INDEX "PageView_visitorId_createdAt_idx" ON "PageView"("visitorId", "createdAt");
CREATE INDEX "PageView_sessionId_createdAt_idx" ON "PageView"("sessionId", "createdAt");

CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");
