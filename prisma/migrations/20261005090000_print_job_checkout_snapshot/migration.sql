ALTER TABLE "PrintJob"
ADD COLUMN "checkoutSnapshot" JSONB,
ADD COLUMN "replacesPrintJobId" TEXT;
