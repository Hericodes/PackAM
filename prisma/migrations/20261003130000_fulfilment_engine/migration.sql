ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'RECONCILIATION_REQUIRED';

CREATE TYPE "OrderItemSourcingStatus" AS ENUM ('UNAVAILABLE', 'SOURCED', 'PRICE_PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Order"
  ADD COLUMN "assignedRunnerId" TEXT,
  ADD COLUMN "findingRunnerAt" TIMESTAMP(3);

ALTER TABLE "Refund" ADD COLUMN "requestKey" TEXT;

CREATE TABLE "OrderItemSourcing" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "orderSourceId" TEXT NOT NULL,
  "productSourceId" TEXT NOT NULL,
  "reportedByRunnerId" TEXT NOT NULL,
  "status" "OrderItemSourcingStatus" NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "catalogueUnitPrice" INTEGER NOT NULL,
  "actualUnitPrice" INTEGER,
  "autoApproved" BOOLEAN NOT NULL DEFAULT false,
  "priceDecisionAt" TIMESTAMP(3),
  "priceDecisionBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderItemSourcing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RunnerAssignment_orderId_runnerId_key"
  ON "RunnerAssignment"("orderId", "runnerId");
CREATE UNIQUE INDEX "Refund_requestKey_key" ON "Refund"("requestKey");
CREATE INDEX "OrderItemSourcing_orderItemId_status_idx"
  ON "OrderItemSourcing"("orderItemId", "status");
CREATE INDEX "OrderItemSourcing_orderSourceId_idx"
  ON "OrderItemSourcing"("orderSourceId");
CREATE INDEX "OrderItemSourcing_reportedByRunnerId_idx"
  ON "OrderItemSourcing"("reportedByRunnerId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedRunnerId_fkey"
  FOREIGN KEY ("assignedRunnerId") REFERENCES "RunnerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItemSourcing" ADD CONSTRAINT "OrderItemSourcing_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemSourcing" ADD CONSTRAINT "OrderItemSourcing_orderSourceId_fkey"
  FOREIGN KEY ("orderSourceId") REFERENCES "OrderSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemSourcing" ADD CONSTRAINT "OrderItemSourcing_productSourceId_fkey"
  FOREIGN KEY ("productSourceId") REFERENCES "ProductSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItemSourcing" ADD CONSTRAINT "OrderItemSourcing_reportedByRunnerId_fkey"
  FOREIGN KEY ("reportedByRunnerId") REFERENCES "RunnerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
