-- Additive: PrintJob can wait for and later hold an assigned runner without creating an Order.
ALTER TABLE "PrintJob" ADD COLUMN "findingRunnerAt" TIMESTAMP(3);
ALTER TABLE "PrintJob" ADD COLUMN "assignedRunnerId" TEXT;

CREATE INDEX "PrintJob_status_findingRunnerAt_idx" ON "PrintJob"("status", "findingRunnerAt");
CREATE INDEX "PrintJob_assignedRunnerId_idx" ON "PrintJob"("assignedRunnerId");

ALTER TABLE "PrintJob"
  ADD CONSTRAINT "PrintJob_assignedRunnerId_fkey"
  FOREIGN KEY ("assignedRunnerId") REFERENCES "RunnerProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Additive: a RunnerAssignment belongs to exactly one fulfilment root.
ALTER TABLE "RunnerAssignment" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "RunnerAssignment" ADD COLUMN "printJobId" TEXT;

CREATE INDEX "RunnerAssignment_printJobId_idx" ON "RunnerAssignment"("printJobId");
CREATE UNIQUE INDEX "RunnerAssignment_printJobId_runnerId_key" ON "RunnerAssignment"("printJobId", "runnerId");

ALTER TABLE "RunnerAssignment"
  ADD CONSTRAINT "RunnerAssignment_printJobId_fkey"
  FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RunnerAssignment"
  ADD CONSTRAINT "RunnerAssignment_one_fulfilment_root_chk"
  CHECK (
    ("orderId" IS NOT NULL AND "printJobId" IS NULL)
    OR ("orderId" IS NULL AND "printJobId" IS NOT NULL)
  );
