import type { Metadata } from "next";
import { requireRole } from "../../../lib/auth-guard";
import { EMAIL_CAMPAIGN_MIGRATION } from "../../../lib/db-errors";
import { loadEmailAdminView } from "../../../lib/email/campaign-admin";
import { EmailCampaignManager } from "../../../components/admin/EmailCampaignManager";

export const metadata: Metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

const at = (date: Date) => date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });

/** Admin → Emails: the automatic emails' switches and numbers, announcements, and test sends. */
export default async function AdminEmailsPage() {
  await requireRole("ADMIN");
  const view = await loadEmailAdminView();
  const editable = view.ready && view.configured && view.secretConfigured;

  return <main className="min-h-screen"><div className="packam-container max-w-3xl py-8">
    <p className="text-xs font-black uppercase tracking-widest text-black/40">Management</p>
    <h1 className="mt-1 text-3xl font-black">Emails</h1>
    <p className="mt-2 text-sm text-black/60">Automatic emails to students: the good-morning message, the order reminder and order updates, plus announcements you write. Every email has a link to stop it, and students choose what they get in Settings. Runners and admins never get these.</p>

    {!view.ready && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Emails activate after the database update</p>
      <p className="mt-1 leading-6">Until migration <code className="font-mono text-xs">{EMAIL_CAMPAIGN_MIGRATION}</code> is applied, no automatic email is sent and nothing here can be changed.</p>
    </div>}
    {view.ready && !view.configured && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Email isn’t set up on this server</p>
      <p className="mt-1 leading-6">Add RESEND_API_KEY and EMAIL_FROM in Vercel, then redeploy. Nothing is sent until then.</p>
    </div>}
    {view.ready && !view.secretConfigured && <div role="alert" className="mt-5 rounded-2xl border border-[#c92d24]/25 bg-[#ffe9e7] p-4 text-sm text-[#7a1a14]">
      <p className="font-black">Unsubscribe links can’t be made</p>
      <p className="mt-1 leading-6">AUTH_SECRET is missing or too short, so no automatic email is sent (every email must carry a working unsubscribe link).</p>
    </div>}

    <EmailCampaignManager
      editable={editable}
      switches={view.switches}
      announcementAudience={view.announcementAudience}
      broadcasts={view.broadcasts.map((broadcast) => ({ id: broadcast.id, subject: broadcast.subject, status: broadcast.status, recipientCount: broadcast.recipientCount, createdByName: broadcast.createdByName, counts: broadcast.counts, createdLabel: at(broadcast.createdAt), finishedLabel: broadcast.finishedAt ? at(broadcast.finishedAt) : null }))}
    />
  </div></main>;
}
