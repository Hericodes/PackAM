import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "../../../../../auth";
import { PrintTrackingRefresher } from "../../../../../components/student/PrintTrackingRefresher";
import { getStudentPrintTracking } from "../../../../../lib/printing/service";
import { printMissionReference } from "../../../../../lib/printing/runner-mission-policy";
import { printStatusLabel, studentPrintProgress } from "../../../../../lib/printing/tracking-policy";
import { formatCampusTime } from "../../../../../lib/student-copy";

const money = (amount: number | null) => amount === null ? "—" : `₦${amount.toLocaleString()}`;

export default async function PrintJobTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fprinting");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");
  const { id } = await params;
  const job = await getStudentPrintTracking(session.user.id, id);
  if (!job) notFound();
  if (job.status === "DRAFT" || job.status === "READY_FOR_PAYMENT") {
    redirect(job.paymentStatus ? `/printing/payment/${encodeURIComponent(job.id)}` : "/printing");
  }

  const progress = studentPrintProgress(job.status, job.statusHistory.map((entry) => entry.status));
  const pages = job.selectedPageCount ?? 0;

  return (
    <main className="min-h-screen px-4 py-7 sm:py-10">
      <div className="mx-auto max-w-xl">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">PackAM Printing · {printMissionReference(job.id)}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">{progress.issue?.title ?? progress.steps.find((step) => step.state === "current")?.label ?? "Delivered 🎉"}</h1>
        {!progress.isTerminal && <PrintTrackingRefresher />}

        {progress.issue && (
          <p role="status" className="mt-4 rounded-2xl bg-[#fff8df] p-4 text-sm leading-6">{progress.issue.message}</p>
        )}

        <ol className="mt-6 space-y-3" aria-label="Print job progress">
          {progress.steps.map((step) => (
            <li key={step.status} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  step.state === "done" ? "bg-green-100 text-green-800" : step.state === "current" ? "bg-black text-white" : "bg-black/5 text-black/35"
                }`}
              >
                {step.state === "done" ? "✓" : "•"}
              </span>
              <span className={step.state === "upcoming" ? "text-black/40" : "font-bold"}>
                {step.label}
                <span className="sr-only"> — {step.state}</span>
              </span>
            </li>
          ))}
        </ol>

        <section className="mt-7 rounded-2xl border border-black/5 bg-white p-4 sm:p-5" aria-labelledby="print-job-summary">
          <h2 id="print-job-summary" className="text-sm font-black">Print job</h2>
          {job.documentName && <p className="mt-3 break-words text-sm font-bold">{job.documentName}</p>}
          <p className="mt-1 text-sm leading-5 text-black/55">
            {job.colorMode === "COLOR" ? "Colour" : "Black & white"} · {job.sides === "DOUBLE" ? "Double-sided" : "Single-sided"} · {job.paperSize} · {job.copies} {job.copies === 1 ? "copy" : "copies"}
          </p>
          <p className="mt-1 text-sm leading-5 text-black/55">
            {job.pageSelection === "ALL" ? "All pages" : `Pages ${job.pageSelection}`} · {pages} {pages === 1 ? "page" : "pages"}
          </p>
          {(job.deliveryLocationLabel || job.deliveryAddress) && (
            <p className="mt-3 text-sm leading-5 text-black/65">{[job.deliveryLocationLabel, job.deliveryAddress].filter(Boolean).join(" · ")}</p>
          )}
          <div className="mt-4 space-y-1 border-t border-black/10 pt-4 text-sm">
            <p className="flex justify-between"><span className="text-black/55">Printing</span><span>{money(job.printSubtotal)}</span></p>
            <p className="flex justify-between"><span className="text-black/55">Delivery</span><span>{money(job.deliveryFee)}</span></p>
            <p className="flex justify-between text-base font-black"><span>Total paid</span><span>{money(job.total)}</span></p>
          </div>
        </section>

        <section className="mt-5" aria-labelledby="print-job-history">
          <h2 id="print-job-history" className="text-sm font-black">Updates</h2>
          <ul className="mt-2 space-y-1 text-xs text-black/55">
            {job.statusHistory.slice().reverse().map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.createdAt.toISOString()}>{formatCampusTime(entry.createdAt)}</time> · {printStatusLabel(entry.status)}
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/printing" className="inline-flex min-h-11 items-center rounded-full border border-black/10 px-5 text-sm font-bold">Print something else</Link>
          <Link href="/support" className="inline-flex min-h-11 items-center px-2 text-sm font-bold underline underline-offset-4">Get help</Link>
        </div>
      </div>
    </main>
  );
}
