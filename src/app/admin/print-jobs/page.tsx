import Link from "next/link";
import { PrintJobStatus } from "@prisma/client";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { PRINT_STATUS_GROUPS, adminListHref, printJobListWhere } from "../../../lib/admin-list-filters";
import { printStatusDisplay } from "../../../lib/ops-status";
import { printMissionReference } from "../../../lib/printing/runner-mission-policy";
import { formatCampusTime } from "../../../lib/student-copy";
import { StatusBadge } from "../../../components/ui/StatusBadge";

const take = 50;

export default async function AdminPrintJobsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const { where, status, q } = printJobListWhere(params.status, params.q);
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const [jobs, total] = await Promise.all([
    db.printJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: { id: true, status: true, total: true, copies: true, selectedPageCount: true, colorMode: true, createdAt: true, user: { select: { email: true } }, assignedRunner: { select: { user: { select: { firstName: true } } } } },
    }),
    db.printJob.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / take));
  const chip = (value: string, label: string) => <Link key={value || "paid"} href={adminListHref("/admin/print-jobs", { status: value, q })} aria-current={status === value ? "page" : undefined} className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-bold ${status === value ? "bg-black text-white" : "bg-white hover:ring-1 hover:ring-black/15"}`}>{label}</Link>;

  return <main className="min-h-screen"><div className="packam-container py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Daily ops</p>
    <h1 className="mt-1 text-3xl font-black">Print jobs</h1>

    <form action="/admin/print-jobs" role="search" className="mt-4 flex max-w-xl gap-2">
      {status && <input type="hidden" name="status" value={status} />}
      <label htmlFor="print-search" className="sr-only">Search print jobs</label>
      <input id="print-search" name="q" type="search" defaultValue={q} placeholder="Reference (PR-…) or student email" className="pk-input min-h-11 flex-1" />
      <button type="submit" className="pk-btn pk-btn-primary">Search</button>
    </form>

    <nav aria-label="Filter by status" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {chip("", "Paid jobs")}
      {chip("IN_PROGRESS", PRINT_STATUS_GROUPS.IN_PROGRESS.label)}
      {chip("ISSUES", PRINT_STATUS_GROUPS.ISSUES.label)}
      {Object.values(PrintJobStatus).map((value) => chip(value, printStatusDisplay(value).label))}
    </nav>

    <section aria-label="Print jobs" className="mt-5 overflow-hidden rounded-2xl bg-white">
      <div className="hidden grid-cols-[110px_1fr_1.4fr_1fr_90px_1fr] gap-3 border-b border-black/5 bg-[#f7f5ee] px-4 py-2.5 text-xs font-black uppercase tracking-wide text-black/45 md:grid"><span>Reference</span><span>Status</span><span>Student</span><span>Job</span><span>Total</span><span>Created</span></div>
      <ul className="divide-y divide-black/5">{jobs.map((job) => {
        const display = printStatusDisplay(job.status);
        const pages = job.selectedPageCount ?? 0;
        return <li key={job.id}><Link href={`/admin/print-jobs/${job.id}`} className="grid gap-1.5 p-4 hover:bg-black/2 md:grid-cols-[110px_1fr_1.4fr_1fr_90px_1fr] md:items-center md:gap-3">
          <span className="font-black underline-offset-2 md:underline">{printMissionReference(job.id)}</span>
          <span><StatusBadge label={display.label} tone={display.tone} /></span>
          <span className="truncate text-sm">{job.user.email}</span>
          <span className="text-sm text-black/65">{pages} {pages === 1 ? "page" : "pages"} × {job.copies} · {job.colorMode === "COLOR" ? "Colour" : "B&W"}{job.assignedRunner ? ` · ${job.assignedRunner.user.firstName ?? "Runner"}` : ""}</span>
          <span className="text-sm font-black">₦{(job.total ?? 0).toLocaleString()}</span>
          <span className="text-xs text-black/55 md:text-sm">{formatCampusTime(job.createdAt)}</span>
        </Link></li>;
      })}</ul>
      {!jobs.length && <div className="p-8 text-center"><p className="font-black">{q || status ? "No print jobs match this view" : "No paid print jobs yet"}</p><p className="mt-1 text-sm text-black/50">{q || status ? "Try another reference, email or status." : "Printers dey wait. Paid jobs will show up here."}</p>{(q || status) && <Link href="/admin/print-jobs" className="mt-3 inline-flex min-h-10 items-center text-sm font-bold underline">Clear filters</Link>}</div>}
    </section>

    <nav aria-label="Print job pages" className="mt-3 flex flex-wrap items-center gap-4 text-sm">
      <span className="text-black/50">{total} {total === 1 ? "job" : "jobs"} · Page {page} of {pages}</span>
      {page > 1 && <Link href={adminListHref("/admin/print-jobs", { status, q, page: page - 1 })} className="inline-flex min-h-10 items-center font-bold underline">← Newer</Link>}
      {page < pages && <Link href={adminListHref("/admin/print-jobs", { status, q, page: page + 1 })} className="inline-flex min-h-10 items-center font-bold underline">Older →</Link>}
    </nav>
  </div></main>;
}
