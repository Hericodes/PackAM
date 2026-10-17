import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { PrintStudio } from "../../components/student/PrintStudio";
import { db } from "../../lib/db";
import Link from "next/link";
import { CHECKOUT_DELIVERY_FEE } from "../../lib/checkout-pricing";
import { PRINTING_PRICES } from "../../lib/printing/pricing";
import { printStatusLabel } from "../../lib/printing/tracking-policy";
import { getStudentPrintWorkspace, listStudentPaidPrintJobs } from "../../lib/printing/service";

export default async function PrintingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fprinting");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");

  const [locations, initialJob, paidJobs] = await Promise.all([
    db.savedLocation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, address: true, instructions: true, latitude: true, longitude: true },
    }),
    getStudentPrintWorkspace(session.user.id),
    listStudentPaidPrintJobs(session.user.id),
  ]);
  if (
    initialJob?.activePaymentStatus === "PENDING" ||
    initialJob?.activePaymentStatus === "RECONCILIATION_REQUIRED" ||
    initialJob?.activePaymentStatus === "SUCCESS"
  ) {
    redirect(`/printing/payment/${encodeURIComponent(initialJob.id)}`);
  }

  return (
    <>
      <StudentNavbar />
      <main className="min-h-screen pb-8">
        <section className="pk-hero">
          <div className="packam-container py-7 sm:py-10">
            <p className="pk-eyebrow">PackAM Printing</p>
            <h1 className="pk-page-title mt-2">Print your document</h1>
            <p className="pk-muted mt-2 max-w-2xl text-sm leading-6 sm:text-base">
              Upload a PDF, choose how you want it printed, and we&apos;ll bring it to you. You see the exact price before you pay.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Printing prices">
              <li className="pk-pill">₦{PRINTING_PRICES.A4.BLACK_AND_WHITE.toLocaleString()} / page · black &amp; white</li>
              <li className="pk-pill">₦{PRINTING_PRICES.A4.COLOR.toLocaleString()} / page · colour</li>
              <li className="pk-pill pk-pill-neutral">₦{CHECKOUT_DELIVERY_FEE.toLocaleString()} delivery</li>
              <li className="pk-pill pk-pill-neutral">Double-sided costs the same</li>
            </ul>
          </div>
        </section>
        <div className="packam-container">
          <PrintStudio
            locations={locations}
            initialJob={initialJob}
          />
          {paidJobs.length > 0 && (
            <section className="mt-10 max-w-2xl" aria-labelledby="your-print-jobs">
              <h2 id="your-print-jobs" className="text-lg font-black">Your print jobs</h2>
              <ul className="mt-3 space-y-2">
                {paidJobs.map((job) => (
                  <li key={job.id}>
                    <Link href={`/printing/jobs/${encodeURIComponent(job.id)}`} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{job.documentName ?? "Print job"}</span>
                        <span className="block text-xs text-black/60">{printStatusLabel(job.status)} · {job.selectedPageCount ?? 0} pages × {job.copies}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold">Track →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
