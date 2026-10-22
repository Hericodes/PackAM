import Link from "next/link";
import { requireRole } from "../../../../lib/auth-guard";
import { notFound } from "next/navigation";
import { AdminPrintJobActions } from "../../../../components/admin/AdminPrintJobActions";
import { db } from "../../../../lib/db";
import { printMissionReference } from "../../../../lib/printing/runner-mission-policy";
import { canTransitionPrintJob } from "../../../../lib/printing/status-machine";

export default async function AdminPrintJobPage({ params }: { params: Promise<{ id: string }> }) {
 await requireRole("ADMIN");
  const { id } = await params;
  const [job, issues] = await Promise.all([
    db.printJob.findUnique({
      where: { id },
      select: {
        id: true, status: true, paperSize: true, colorMode: true, sides: true, copies: true, pageSelection: true, selectedPageCount: true,
        instructions: true, printSubtotal: true, deliveryFee: true, total: true, checkoutSnapshot: true, findingRunnerAt: true, createdAt: true,
        user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        document: { select: { originalFileName: true, pageCount: true, fileSize: true, deletedAt: true } },
        assignedRunner: { select: { user: { select: { firstName: true, lastName: true } } } },
        assignments: { orderBy: { offeredAt: "asc" }, select: { id: true, status: true, offeredAt: true, acceptedAt: true, runner: { select: { user: { select: { firstName: true, lastName: true } } } } } },
        payments: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, provider: true, amount: true, transactionReference: true, providerReference: true, paidAt: true } },
        statusHistory: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, note: true, createdAt: true } },
      },
    }),
    db.auditLog.findMany({
      where: { resource: "PrintJob", resourceId: id, action: { in: ["PRINT_DELIVERY_ISSUE", "PRINT_DOCUMENT_UNREADABLE", "PRINT_FAILED", "PRINT_UNPAID_CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, details: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  if (!job) notFound();
  const snapshot = job.checkoutSnapshot && typeof job.checkoutSnapshot === "object" && !Array.isArray(job.checkoutSnapshot) ? job.checkoutSnapshot as Record<string, unknown> : {};
  const capturedPayment = job.payments.find((payment) => payment.status === "SUCCESS");
  const canRetry = (job.status === "DOCUMENT_UNREADABLE" || job.status === "PRINT_FAILED") && Boolean(job.assignedRunner);
  const canRefund = Boolean(capturedPayment) && canTransitionPrintJob(job.status, "REFUND_PROCESSING");
  const canCancelUnpaid = (job.status === "DRAFT" || job.status === "READY_FOR_PAYMENT") && !capturedPayment;

  return <main className="min-h-screen"><div className="packam-container py-8">
    <Link href="/admin/exceptions" className="text-sm font-bold text-black/50">← Exceptions</Link>
    <section className="mt-4 rounded-3xl bg-white p-5 sm:p-7">
      <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-black/40">Print job {printMissionReference(job.id)} · {job.id}</p><h1 className="mt-1 text-2xl font-black">{job.status.replaceAll("_", " ")}</h1></div><p className="text-xl font-black">₦{(job.total ?? 0).toLocaleString()}</p></div>
      <AdminPrintJobActions printJobId={job.id} canRetry={canRetry} canRefund={canRefund} canCancelUnpaid={canCancelUnpaid} canRedispatch={job.status === "FINDING_RUNNER" && !job.assignedRunner} />
      {job.status === "REFUND_PROCESSING" && <p className="mt-4 rounded-xl bg-[#fff8df] p-3 text-sm">Refund processing: complete the refund manually in OPay. PackAM has no automated print refund — this job is not marked refunded.</p>}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section><h2 className="font-black">Student and delivery</h2>
          <p className="mt-2 text-sm">{job.user.firstName} {job.user.lastName} · {job.user.email} · {job.user.phone ?? "No phone"}</p>
          <p className="mt-2 text-sm">{typeof snapshot.deliveryLocationLabel === "string" ? `${snapshot.deliveryLocationLabel} · ` : ""}{typeof snapshot.deliveryAddress === "string" ? snapshot.deliveryAddress : "No delivery address"}</p>
          {typeof snapshot.deliveryInstructions === "string" && <p className="mt-1 text-sm text-black/55">{snapshot.deliveryInstructions}</p>}
          <p className="mt-2 text-sm">Runner: {job.assignedRunner ? `${job.assignedRunner.user.firstName} ${job.assignedRunner.user.lastName}` : "Unassigned"}</p>
          <p className="mt-1 text-xs text-black/45">{job.assignments.map((a) => `${a.runner.user.firstName} ${a.runner.user.lastName}: ${a.status}`).join(" · ") || "No offers yet."}</p>
        </section>
        <section><h2 className="font-black">Print settings</h2>
          <p className="mt-2 text-sm">{job.document?.originalFileName ?? "No document"}{job.document ? ` · ${job.document.pageCount} pages · ${(job.document.fileSize / 1024 / 1024).toFixed(1)} MB${job.document.deletedAt ? " · deleted" : ""}` : ""}</p>
          <p className="mt-1 text-sm">{job.selectedPageCount ?? 0} selected ({job.pageSelection}) · {job.copies} cop{job.copies === 1 ? "y" : "ies"} · {job.colorMode} · {job.sides} · {job.paperSize}</p>
          {job.instructions && <p className="mt-1 text-sm text-black/55">{job.instructions}</p>}
          <p className="mt-3 text-sm">Printing ₦{(job.printSubtotal ?? 0).toLocaleString()} · Delivery ₦{(job.deliveryFee ?? 0).toLocaleString()} · Total ₦{(job.total ?? 0).toLocaleString()}</p>
          {job.payments.map((payment) => <p key={payment.id} className="mt-1 break-all text-xs text-black/50">{payment.provider} {payment.status} · ₦{payment.amount.toLocaleString()} · {payment.transactionReference ?? "—"} · provider {payment.providerReference ?? "pending"}</p>)}
        </section>
      </div>
      <h2 className="mt-7 font-black">Reported issues</h2>
      {issues.length ? issues.map((issue) => <div key={issue.id} className="mt-2 rounded-xl bg-[#fff8df] p-3 text-sm"><p><strong>{issue.action.replaceAll("_", " ")}</strong> · {issue.actor.firstName} {issue.actor.lastName} · {issue.createdAt.toLocaleString()}</p>{issue.details && <span className="block text-xs text-black/55">{issue.details}</span>}</div>) : <p className="mt-2 text-sm text-black/45">No issues reported.</p>}
      <h2 className="mt-7 font-black">Status history</h2>
      <ul className="mt-2 space-y-2">{job.statusHistory.map((entry) => <li key={entry.id} className="text-sm">{entry.createdAt.toLocaleString()} · <strong>{entry.status}</strong>{entry.note ? ` · ${entry.note}` : ""}</li>)}</ul>
    </section>
  </div></main>;
}
