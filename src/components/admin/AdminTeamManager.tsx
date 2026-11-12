"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminTeamMember } from "../../lib/admin/admin-management";

/** Add an admin by email, and remove admins (back to a student or runner account). The server checks every rule. */
export function AdminTeamManager({ team, currentUserId, canManage }: { team: AdminTeamMember[]; currentUserId: string; canManage: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<{ id: string; role: "STUDENT" | "RUNNER" } | null>(null);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy("add"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t add that admin. Try again.");
      setEmail("");
      setMessage(`${data.admin?.name ?? "They"} ${data.admin?.name ? "is" : "are"} now an admin.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t add that admin. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(member: AdminTeamMember, role: "STUDENT" | "RUNNER") {
    if (busy) return;
    setBusy(member.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/admins", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: member.id, role }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "We couldn’t remove that admin. Try again.");
      setRemoving(null);
      setMessage(`${member.name} is no longer an admin.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t remove that admin. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {canManage && (
        <form onSubmit={add} className="rounded-2xl bg-white p-4 sm:p-5">
          <h2 className="text-lg font-black">Add an admin</h2>
          <p className="mt-1 text-sm text-black/60">They need a PackAM account first. Enter the email they signed up with.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="admin-email" className="sr-only">Their email</label>
            <input id="admin-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="off" className="pk-input min-h-12 flex-1" />
            <button type="submit" disabled={busy !== null || !email.trim()} aria-busy={busy === "add"} className="pk-btn pk-btn-primary min-h-12 shrink-0">{busy === "add" ? "Adding…" : "Make admin"}</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-2xl bg-[#e9f8ee] px-4 py-3 text-sm font-semibold text-[#16803c]">{message}</p>}

      <section aria-labelledby="admin-team" className="rounded-2xl bg-white p-4 sm:p-5">
        <h2 id="admin-team" className="text-lg font-black">Admins ({team.length})</h2>
        <ul className="mt-3 divide-y divide-black/5">
          {team.map((member) => {
            const self = member.id === currentUserId;
            const removable = canManage && !self && !member.isSuper;
            return (
              <li key={member.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-black">
                    {member.name}
                    {member.isSuper && <span className="rounded-full bg-black px-2 py-0.5 text-[0.6875rem] font-black text-[#feb80a]">Super admin</span>}
                    {self && <span className="rounded-full bg-black/5 px-2 py-0.5 text-[0.6875rem] font-bold text-black/60">You</span>}
                    {member.delivering && <span className="rounded-full bg-[#e9f8ee] px-2 py-0.5 text-[0.6875rem] font-bold text-[#16803c]">Delivering</span>}
                  </p>
                  <p className="truncate text-xs text-black/55">{member.email}{member.phone ? ` · ${member.phone}` : ""}</p>
                </div>
                {removable && (removing?.id === member.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`demote-${member.id}`} className="text-xs font-bold text-black/60">Make them a</label>
                    <select id={`demote-${member.id}`} value={removing.role} onChange={(event) => setRemoving({ id: member.id, role: event.target.value === "RUNNER" ? "RUNNER" : "STUDENT" })} className="pk-input min-h-10 py-1 text-sm">
                      <option value="STUDENT">Student</option>
                      <option value="RUNNER">Runner</option>
                    </select>
                    <button type="button" onClick={() => void remove(member, removing.role)} disabled={busy !== null} aria-busy={busy === member.id} className="pk-btn pk-btn-sm bg-[#c92d24] text-white hover:bg-[#a8241d]">{busy === member.id ? "Removing…" : "Remove admin"}</button>
                    <button type="button" onClick={() => setRemoving(null)} disabled={busy !== null} className="pk-btn pk-btn-ghost pk-btn-sm">Cancel</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRemoving({ id: member.id, role: "STUDENT" })} className="pk-btn pk-btn-secondary pk-btn-sm self-start sm:self-auto">Remove…</button>
                ))}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
