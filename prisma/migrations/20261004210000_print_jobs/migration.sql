CREATE TYPE "OrderKind" AS ENUM ('MARKETPLACE', 'PRINTING');
CREATE TYPE "PrintJobStatus" AS ENUM (
  'DRAFT',
  'READY_FOR_PAYMENT',
  'PAYMENT_CONFIRMED',
  'FINDING_RUNNER',
  'RUNNER_ASSIGNED',
  'DOCUMENT_RECEIVED',
  'PRINTING',
  'PRINTED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'DOCUMENT_UNREADABLE',
  'PRINT_FAILED',
  'REFUND_PROCESSING',
  'REFUNDED',
  'FAILED'
);
CREATE TYPE "PrintPaperSize" AS ENUM ('A4');
CREATE TYPE "PrintColorMode" AS ENUM ('BLACK_AND_WHITE', 'COLOR');
CREATE TYPE "PrintSides" AS ENUM ('SINGLE', 'DOUBLE');

ALTER TABLE "Order" ADD COLUMN "kind" "OrderKind" NOT NULL DEFAULT 'MARKETPLACE';
CREATE INDEX "Order_kind_status_idx" ON "Order"("kind", "status");

CREATE TABLE "PrintJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'DRAFT',
  "paperSize" "PrintPaperSize" NOT NULL DEFAULT 'A4',
  "colorMode" "PrintColorMode",
  "sides" "PrintSides",
  "copies" INTEGER NOT NULL DEFAULT 1,
  "pageSelection" TEXT NOT NULL DEFAULT 'ALL',
  "selectedPageCount" INTEGER,
  "instructions" TEXT,
  "pricePerPage" INTEGER,
  "printSubtotal" INTEGER,
  "deliveryFee" INTEGER,
  "total" INTEGER,
  "pricingVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrintJob_orderId_key" ON "PrintJob"("orderId");
CREATE INDEX "PrintJob_userId_createdAt_idx" ON "PrintJob"("userId", "createdAt");
CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PrintDocument" (
  "id" TEXT NOT NULL,
  "printJobId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "storageProvider" TEXT NOT NULL DEFAULT 'CLOUDINARY',
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PrintDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrintDocument_printJobId_key" ON "PrintDocument"("printJobId");
CREATE UNIQUE INDEX "PrintDocument_publicId_key" ON "PrintDocument"("publicId");
CREATE INDEX "PrintDocument_uploadedById_uploadedAt_idx" ON "PrintDocument"("uploadedById", "uploadedAt");
CREATE INDEX "PrintDocument_expiresAt_deletedAt_idx" ON "PrintDocument"("expiresAt", "deletedAt");
ALTER TABLE "PrintDocument" ADD CONSTRAINT "PrintDocument_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintDocument" ADD CONSTRAINT "PrintDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PrintJobStatusHistory" (
  "id" TEXT NOT NULL,
  "printJobId" TEXT NOT NULL,
  "status" "PrintJobStatus" NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrintJobStatusHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrintJobStatusHistory_printJobId_createdAt_idx" ON "PrintJobStatusHistory"("printJobId", "createdAt");
CREATE INDEX "PrintJobStatusHistory_actorId_createdAt_idx" ON "PrintJobStatusHistory"("actorId", "createdAt");
ALTER TABLE "PrintJobStatusHistory" ADD CONSTRAINT "PrintJobStatusHistory_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJobStatusHistory" ADD CONSTRAINT "PrintJobStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "printJobId" TEXT;
CREATE INDEX "Payment_printJobId_status_idx" ON "Payment"("printJobId", "status");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
