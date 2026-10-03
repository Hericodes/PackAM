import Link from "next/link";
import { PaymentStatus } from "@prisma/client";
import { db } from "../../../lib/db";
import { summarizeKnownOrderMoney } from "../../../lib/finance";

type Search = { from?: string; to?: string; orderId?: string; vendorId?: string; runnerId?: string; paymentStatus?: string };

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function AdminFinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const from = validDate(search.from); const toDate = validDate(search.to);
  const to = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : undefined;
  const paymentStatus = Object.values(PaymentStatus).includes(search.paymentStatus as PaymentStatus) ? search.paymentStatus as PaymentStatus : "SUCCESS";
  const where = {
    createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) },
    payment: { is: { status: paymentStatus } },
    ...(search.orderId && search.orderId.length <= 64 ? { id: search.orderId } : {}),
    ...(search.runnerId && search.runnerId.length <= 64 ? { assignedRunnerId: search.runnerId } : {}),
    ...(search.vendorId && search.vendorId.length <= 64 ? { sources: { some: { vendorId: search.vendorId } } } : {}),
  };
  const [aggregate, orders, refunds, payouts, vendors, runners] = await Promise.all([
    db.order.aggregate({ where, _sum: { subtotal: true, deliveryFee: true, total: true }, _count: { _all: true } }),
    db.order.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, subtotal: true, deliveryFee: true, total: true, currency: true, status: true, createdAt: true, payment: { select: { status: true } }, assignedRunner: { select: { user: { select: { firstName: true, lastName: true } } } }, sources: { select: { vendor: { select: { id: true, name: true } } } } } }),
    db.refund.aggregate({ where: { status: "COMPLETED", order: where }, _sum: { amount: true } }),
    db.runnerPayout.aggregate({ where: { status: "PAID", ...(search.runnerId && search.runnerId.length <= 64 ? { runnerId: search.runnerId } : {}), createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }, _sum: { amount: true } }),
    db.vendor.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } }),
    db.runnerProfile.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  const totals = summarizeKnownOrderMoney([{ subtotal: aggregate._sum.subtotal ?? 0, deliveryFee: aggregate._sum.deliveryFee ?? 0, total: aggregate._sum.total ?? 0 }]);
  return <main className="min-h-screen bg-[#f7f5ee]"><div className="packam-container py-8"><h1 className="text-3xl font-black">Finance</h1><p className="mt-2 max-w-3xl text-sm text-black/55">Amounts are integer NGN from successful PackAM orders. GMV is the customer transaction value, not PackAM revenue. Vendor settlement, commission base, payment processing fees and customer credits are not recorded by the current schema, so net revenue and contribution margin cannot be stated accurately.</p>
    <form className="mt-5 grid gap-2 rounded-2xl bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"><input type="date" name="from" defaultValue={search.from} className="rounded-xl border px-3 py-2 text-sm"/><input type="date" name="to" defaultValue={search.to} className="rounded-xl border px-3 py-2 text-sm"/><input name="orderId" defaultValue={search.orderId} placeholder="Order ID" className="rounded-xl border px-3 py-2 text-sm"/><select name="vendorId" defaultValue={search.vendorId} className="rounded-xl border bg-white px-3 py-2 text-sm"><option value="">All vendors</option>{vendors.map((v)=><option key={v.id} value={v.id}>{v.name}</option>)}</select><select name="runnerId" defaultValue={search.runnerId} className="rounded-xl border bg-white px-3 py-2 text-sm"><option value="">All runners</option>{runners.map((r)=><option key={r.id} value={r.id}>{r.user.firstName} {r.user.lastName}</option>)}</select><select name="paymentStatus" defaultValue={search.paymentStatus ?? "SUCCESS"} className="rounded-xl border bg-white px-3 py-2 text-sm">{Object.values(PaymentStatus).map((s)=><option key={s}>{s}</option>)}</select><button className="rounded-full bg-black px-4 py-2 text-sm font-bold text-white">Filter</button><Link href="/admin/finance" className="px-3 py-2 text-sm font-bold underline">Clear</Link></form>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["GMV / customer payments",totals.gmv],["Product sales",totals.productSales],["Delivery fees",totals.deliveryFees],["Completed refunds",refunds._sum.amount??0],["Runner payouts paid",payouts._sum.amount??0]].map(([label,value])=><section key={label} className="rounded-2xl bg-white p-5"><p className="text-xs font-bold uppercase text-black/40">{label}</p><p className="mt-2 text-2xl font-black">₦{Number(value).toLocaleString()}</p></section>)}{[["PackAM commission","Not recorded"],["Vendor amount","Not recorded"],["Processing fees","Not returned by provider"],["Customer credits","No credit ledger"],["Contribution margin","Not calculable"]].map(([label,value])=><section key={label} className="rounded-2xl bg-white p-5"><p className="text-xs font-bold uppercase text-black/40">{label}</p><p className="mt-2 text-lg font-black">{value}</p></section>)}</div>
    <h2 className="mt-8 text-xl font-black">Order breakdown · {aggregate._count._all} orders</h2><div className="mt-3 overflow-x-auto rounded-2xl bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-black/5 text-xs uppercase text-black/50"><tr>{["Order","Date","State","Payment","Product sales","Delivery","Customer total","Sources","Runner"].map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-black/5">{orders.map((o)=><tr key={o.id}><td className="px-4 py-3"><Link className="underline" href={`/admin/orders/${o.id}`}>{o.id}</Link></td><td className="px-4 py-3">{o.createdAt.toLocaleDateString()}</td><td className="px-4 py-3">{o.status}</td><td className="px-4 py-3">{o.payment?.status}</td><td className="px-4 py-3">₦{o.subtotal.toLocaleString()}</td><td className="px-4 py-3">₦{o.deliveryFee.toLocaleString()}</td><td className="px-4 py-3">₦{o.total.toLocaleString()}</td><td className="px-4 py-3">{o.sources.map((s)=>s.vendor.name).join(", ")||"—"}</td><td className="px-4 py-3">{o.assignedRunner?.user.firstName} {o.assignedRunner?.user.lastName}</td></tr>)}</tbody></table></div></div></main>;
}
