-- Operations review cases for unresolved payments.
--
-- Additive only: no existing table or column changes. A review case tracks whether operations is
-- still working on a payment and the last admin-triggered OPay check; Payment.status remains the only
-- record of the money state, so closing a case can never mark a payment paid, failed or refunded.

-- CreateEnum
CREATE TYPE "PaymentReviewStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "PaymentReviewCase" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" "PaymentReviewStatus" NOT NULL DEFAULT 'OPEN',
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckOutcome" TEXT,
    "lastCheckDetail" TEXT,
    "checkCount" INTEGER NOT NULL DEFAULT 0,
    "checkLockedUntil" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReviewCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReviewCase_paymentId_key" ON "PaymentReviewCase"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentReviewCase_status_updatedAt_idx" ON "PaymentReviewCase"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "PaymentReviewCase" ADD CONSTRAINT "PaymentReviewCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
