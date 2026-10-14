import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { PrintStudio } from "../../components/student/PrintStudio";
import { db } from "../../lib/db";
import Link from "next/link";
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
      <main className="min-h-screen bg-[#fffdf7] pb-8">
        <div className="packam-container py-7 sm:py-10">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">PackAM Printing</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Print your document</h1>
            <p className="mt-2 text-sm leading-6 text-black/60 sm:text-base">
              Upload your PDF, choose how you want it printed, and we&apos;ll bring it to you.
            </p>
          </div>
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
