import type { Metadata } from "next";
import { requireSuperAdminPage } from "../../../lib/admin/admin-access";
import { listAdminTeam } from "../../../lib/admin/admin-management";
import { AdminTeamManager } from "../../../components/admin/AdminTeamManager";

export const metadata: Metadata = { title: "Admins" };
export const dynamic = "force-dynamic";

/** Super admin only: who is an admin, adding admins by email, and removing them. */
export default async function AdminAdminsPage() {
  const access = await requireSuperAdminPage("/admin/admins");
  const team = await listAdminTeam();
  return (
    <main className="min-h-screen">
      <div className="packam-container max-w-3xl py-8">
        <p className="text-xs font-black uppercase tracking-widest text-black/40">Management</p>
        <h1 className="mt-1 text-3xl font-black">Admins</h1>
        <p className="mt-2 text-sm leading-6 text-black/60">
          Admins can run orders, payments, the catalogue, food, runners, prices, promo codes, emails and support. Only the super admin sees Finance, Analytics and the Audit log, and adds or removes admins.
        </p>

        {!access.configured && (
          <section className="mt-5 rounded-2xl border border-[#e8c238] bg-[#fff8df] p-4 text-sm leading-6">
            <p className="font-black">Admin levels aren’t switched on yet</p>
            <p className="mt-1 text-black/70">Right now every admin can open everything, and nobody can add or remove admins here. To make yourself the super admin:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-black/75">
              <li>In Vercel, open your PackAM project → Settings → Environment Variables.</li>
              <li>Add <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">SUPER_ADMIN_EMAILS</code> with the email of your PackAM admin account (Production).</li>
              <li>Redeploy. You’ll then see this page with the add and remove controls, and other admins won’t see Finance, Analytics or the Audit log.</li>
            </ol>
          </section>
        )}

        <AdminTeamManager team={team} currentUserId={access.userId} canManage={access.canManageAdmins} />
      </div>
    </main>
  );
}
