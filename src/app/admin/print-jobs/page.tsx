import Link from "next/link";
import { PrintJobStatus } from "@prisma/client";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { printMissionReference } from "../../../lib/printing/runner-mission-policy";
import { formatCampusTime } from "../../../lib/student-copy";

const take = 50;

export default async function AdminPrintJobsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await requireRole("ADMIN");
  const params = await searchParams;
  const filter = Object.values(PrintJobStatus).includes(params.status as PrintJobStatus) ? params.status as PrintJobStatus : undefined;
  const page = Math.max(1, Number(params.page) || 1);
  // Drafts and unpaid jobs are student workspace, not operations work, unless asked for explicitly.
  const where = filter ? { status: filter } : { status: { notIn: [PrintJobStatus.DRAFT, PrintJobStatus.READY_FOR_PAYMENT] } };
  const [jobs, total] = await Promise.all([
    db.printJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * take,
      take,
      select: { id: true, status: true, total: true, copies: true, selectedPageCount: true, createdAt: true, user: { select: { email: true } }, assignedRunner: { select: { user: { select: { firstName: true } } } } },
    }),
    db.printJob.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / take));
  const href = (next: { status?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (next.status) query.set("status", next.status);
    if (next.page && next.page > 1) query.set("page", String(next.page));
    return `/admin/print-jobs${query.size ? `?${query}` : ""}`;
  };

  return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8">
    <h1 className="text-3xl font-black">Print jobs</h1>
    <nav aria-label="Filter by status" className="mt-4 flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
      <Link href={href({})} aria-current={!filter ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-bold ${!filter ? "bg-black text-white" : "bg-white"}`}>Paid jobs</Link>
      {Object.values(PrintJobStatus).map((status) => <Link key={status} href={href({ status })} aria-current={filter === status ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-bold ${filter === status ? "bg-black text-white" : "bg-white"}`}>{status.replaceAll("_", " ").toLowerCase()}</Link>)}
    </nav>
    <div className="mt-4 overflow-x-auto rounded-2xl bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-black/5 text-xs uppercase text-black/60"><tr>{["Reference", "Status", "Student", "Job", "Runner", "Total", "Created"].map((x) => <th key={x} className="px-4 py-3">{x}</th>)}</tr></thead>
        <tbody className="divide-y divide-black/5">
          {jobs.map((job) => <tr key={job.id}>
            <td className="px-4 py-3"><Link className="font-bold underline" href={`/admin/print-jobs/${job.id}`}>{printMissionReference(job.id)}</Link></td>
            <td className="px-4 py-3">{job.status.replaceAll("_", " ").toLowerCase()}</td>
            <td className="px-4 py-3">{job.user.email}</td>
            <td className="px-4 py-3">{job.selectedPageCount ?? 0} pages × {job.copies}</td>
            <td className="px-4 py-3">{job.assignedRunner?.user.firstName ?? "—"}</td>
            <td className="px-4 py-3">₦{(job.total ?? 0).toLocaleString()}</td>
            <td className="px-4 py-3">{formatCampusTime(job.createdAt)}</td>
          </tr>)}
          {!jobs.length && <tr><td colSpan={7} className="px-4 py-6 text-black/60">No print jobs here.</td></tr>}
        </tbody>
      </table>
    </div>
    {pages > 1 && <div className="mt-4 flex items-center gap-3 text-sm font-bold">
      {page > 1 && <Link href={href({ status: filter, page: page - 1 })} className="underline">← Newer</Link>}
      <span>Page {page} of {pages}</span>
      {page < pages && <Link href={href({ status: filter, page: page + 1 })} className="underline">Older →</Link>}
    </div>}
  </div></main>;
}
