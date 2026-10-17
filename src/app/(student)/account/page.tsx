import type { Metadata } from "next";
import Link from "next/link";
import { AddressBook } from "../../../components/student/AddressBook";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";

export const metadata: Metadata = { title: "Account" };

const SHORTCUTS = [
  { href: "/orders", icon: "📦", label: "Orders", body: "Track and reorder" },
  { href: "/printing", icon: "🖨️", label: "Print jobs", body: "Upload and track printing" },
  { href: "/saved", icon: "♡", label: "Saved items", body: "Kept on this device" },
  { href: "/product-requests", icon: "🙏", label: "Requests", body: "Items you asked us to find" },
  { href: "/notifications", icon: "🔔", label: "Notifications", body: "Every update in one place" },
  { href: "/support", icon: "💬", label: "Help & support", body: "Talk to the PackAM team" },
];

export default async function AccountPage() {
  const session = await requireRole("STUDENT", "/account");
  const [user, addresses] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: { firstName: true, lastName: true, email: true, phone: true, createdAt: true, studentProfile: { select: { matricNumber: true, department: true, faculty: true, level: true } } },
    }),
    db.savedLocation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, address: true, instructions: true },
    }),
  ]);
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Student";
  const profile = user?.studentProfile;
  const details = [
    ["Email", user?.email],
    ["Phone", user?.phone],
    ["Matric number", profile?.matricNumber],
    ["Department", profile?.department],
    ["Faculty", profile?.faculty],
    ["Level", profile?.level],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <main className="min-h-screen pb-16">
      <div className="packam-container py-7 sm:py-10">
        <p className="pk-eyebrow">Account</p>
        <h1 className="pk-page-title mt-2">Hi, {user?.firstName || "there"} 👋</h1>

        <nav aria-label="Account shortcuts" className="mt-6">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {SHORTCUTS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="pk-card pk-card-interactive flex h-full items-start gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff4c7] text-lg" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold">{item.label}</span>
                    <span className="pk-muted mt-0.5 block text-xs">{item.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <section className="pk-card p-5 sm:p-6" aria-labelledby="profile-heading">
            <h2 id="profile-heading" className="text-lg font-black">Your details</h2>
            <p className="mt-1 text-base font-bold">{name}</p>
            <dl className="mt-3 divide-y divide-black/5 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2.5">
                  <dt className="pk-muted">{label}</dt>
                  <dd className="min-w-0 break-all text-right font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="pk-muted mt-3 text-xs leading-5">To change these details, contact <Link href="/support" className="font-bold underline">support</Link>.</p>
          </section>

          <section className="pk-card p-5 sm:p-6" aria-labelledby="addresses-heading">
            <h2 id="addresses-heading" className="text-lg font-black">Delivery addresses</h2>
            <p className="pk-muted mt-1 text-sm">Used at checkout and for print delivery.</p>
            <div className="mt-4">
              <AddressBook initial={addresses} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
