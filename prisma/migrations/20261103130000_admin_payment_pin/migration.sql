-- Personal payment PINs for admins: asked for before confirming or rejecting a bank transfer.
-- Additive only: one new table. No existing table, column or row changes, so code from before this migration keeps
-- working, and the PIN code refuses payment actions (fails closed) on a database without it.
-- Only a bcrypt hash is stored. Deleting a user deletes their PIN.
-- Rollback: DROP TABLE "AdminPaymentPin";
CREATE TABLE "AdminPaymentPin" (
    "userId" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPaymentPin_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "AdminPaymentPin_failedCount_check" CHECK ("failedCount" >= 0)
);

ALTER TABLE "AdminPaymentPin" ADD CONSTRAINT "AdminPaymentPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
