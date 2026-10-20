import { OrderStatus, PrintJobStatus, type Prisma } from "@prisma/client";

/**
 * Filters for the admin order and print-job lists. Pure, so the rules are unit-tested; the pages
 * pass the result straight to Prisma. Searches only narrow what an admin can already see.
 */

export const PRINT_STATUS_GROUPS = {
  IN_PROGRESS: { label: "In progress", statuses: [PrintJobStatus.RUNNER_ASSIGNED, PrintJobStatus.DOCUMENT_RECEIVED, PrintJobStatus.PRINTING, PrintJobStatus.PRINTED, PrintJobStatus.OUT_FOR_DELIVERY] },
  ISSUES: { label: "Problems", statuses: [PrintJobStatus.DOCUMENT_UNREADABLE, PrintJobStatus.PRINT_FAILED] },
} as const;

export const ORDER_STATUS_GROUPS = {
  ACTIVE: { label: "In progress", statuses: [OrderStatus.PAYMENT_CONFIRMED, OrderStatus.FINDING_RUNNER, OrderStatus.RUNNER_ASSIGNED, OrderStatus.SOURCING_PRODUCT, OrderStatus.OUT_FOR_DELIVERY] },
} as const;

const clean = (value: string | undefined) => (value ?? "").trim().slice(0, 100);

/** "PR-1A2B3C4D" or "1a2b3c4d" → the id suffix a print reference is made from. */
function printReferenceSuffix(q: string) {
  const match = /^(?:PR-?)?([a-z0-9]{6,8})$/i.exec(q);
  return match ? match[1].toLowerCase() : null;
}

export function printJobListWhere(statusParam: string | undefined, qParam: string | undefined): { where: Prisma.PrintJobWhereInput; status: string; q: string } {
  const status = clean(statusParam);
  const q = clean(qParam);
  const group = PRINT_STATUS_GROUPS[status as keyof typeof PRINT_STATUS_GROUPS];
  const single = (Object.values(PrintJobStatus) as string[]).includes(status) ? status as PrintJobStatus : null;
  // Drafts and unpaid jobs are student workspace, not operations work, unless asked for explicitly.
  const statusWhere: Prisma.PrintJobWhereInput = group
    ? { status: { in: [...group.statuses] } }
    : single ? { status: single } : { status: { notIn: [PrintJobStatus.DRAFT, PrintJobStatus.READY_FOR_PAYMENT] } };
  const suffix = q ? printReferenceSuffix(q) : null;
  const searchWhere: Prisma.PrintJobWhereInput = !q ? {} : {
    OR: [
      { user: { email: { contains: q, mode: "insensitive" } } },
      ...(suffix ? [{ id: { endsWith: suffix } }] : []),
    ],
  };
  return { where: { ...statusWhere, ...searchWhere }, status: group || single ? status : "", q };
}

export function orderListWhere(statusParam: string | undefined, qParam: string | undefined): { where: Prisma.OrderWhereInput; status: string; q: string } {
  const status = clean(statusParam);
  const q = clean(qParam);
  const group = ORDER_STATUS_GROUPS[status as keyof typeof ORDER_STATUS_GROUPS];
  const single = (Object.values(OrderStatus) as string[]).includes(status) ? status as OrderStatus : null;
  const statusWhere: Prisma.OrderWhereInput = group ? { status: { in: [...group.statuses] } } : single ? { status: single } : {};
  const words = q.split(/\s+/).filter(Boolean).slice(0, 3);
  const searchWhere: Prisma.OrderWhereInput = !q ? {} : {
    OR: [
      { id: q },
      // Student-facing order references are the last 8 characters of the id.
      ...(/^[a-z0-9]{6,8}$/i.test(q) ? [{ id: { endsWith: q.toLowerCase() } }] : []),
      { user: { email: { contains: q, mode: "insensitive" } } },
      { user: { AND: words.map((word) => ({ OR: [{ firstName: { contains: word, mode: "insensitive" as const } }, { lastName: { contains: word, mode: "insensitive" as const } }] })) } },
    ],
  };
  return { where: { ...statusWhere, ...searchWhere }, status: group || single ? status : "", q };
}

export function adminListHref(path: string, params: { status?: string; q?: string; page?: number }) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  if (params.page && params.page > 1) query.set("page", String(params.page));
  return `${path}${query.size ? `?${query}` : ""}`;
}
