export function isOrphanedSuccessfulMarketplacePayment(payment: {
  status: string;
  orderId: string | null;
  printJobId: string | null;
}) {
  return payment.status === "SUCCESS" && payment.orderId === null && payment.printJobId === null;
}

export function isPaymentReconciliationIssue(payment: {
  status: string;
  orderId: string | null;
  printJobId: string | null;
}) {
  return payment.status === "RECONCILIATION_REQUIRED" || isOrphanedSuccessfulMarketplacePayment(payment);
}

export const orphanedSuccessfulMarketplacePaymentWhere = {
  status: "SUCCESS" as const,
  orderId: null,
  printJobId: null,
};
