"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DeliveryDestination } from "./DeliveryDestination";
import { orderStatusDisplay, runnerOrderNextStep } from "../../lib/ops-status";
import { StatusBadge } from "../ui/StatusBadge";

type Source = { id: string; status: string; quantity: number; catalogueUnitPrice: number; actualUnitPrice: number | null; orderSource: { vendor: { name: string } } };
type Item = { id: string; productName: string; quantity: number; unitPrice: number; sourcing: Source[]; plate?: string | null };
type Mission = { assignmentStatus: string; id: string; status: string; items: Item[]; deliveryLocationLabel: string; deliveryAddress?: string; deliveryInstructions?: string | null; deliveryPoint?: { latitude: number; longitude: number; mapsUrl: string } | null; total?: number; student?: { firstName: string | null; phone: string | null }; shop?: { id: string; name: string; location: string | null } | null };
type Vendor = { id: string; name: string; location: string | null };
type IssueType = "CUSTOMER_UNAVAILABLE" | "DELIVERY_ISSUE" | "WRONG_ITEM" | "MISSING_ITEM" | "DAMAGED_ITEM" | "OTHER";

function sourcedQuantity(item: Item) {
  return item.sourcing.filter((entry) => ["SOURCED", "APPROVED"].includes(entry.status)).reduce((sum, entry) => sum + entry.quantity, 0);
}

export function RunnerMissionDetail({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [mission, setMission] = useState<Mission | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorByItem, setVendorByItem] = useState<Record<string, string>>({});
  const [quantityByItem, setQuantityByItem] = useState<Record<string, number>>({});
  const [priceByItem, setPriceByItem] = useState<Record<string, number>>({});
  const [issueType, setIssueType] = useState<IssueType>("DELIVERY_ISSUE");
  const [issueNote, setIssueNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [missionResponse, vendorResponse] = await Promise.all([
      fetch(`/api/runner/missions/${orderId}`),
      fetch("/api/runner/vendors"),
    ]);
    const missionData = await missionResponse.json();
    const vendorData = await vendorResponse.json();
    if (!missionResponse.ok || !vendorResponse.ok) throw new Error(missionData.error || vendorData.error || "Unable to load mission.");
    setMission(missionData.mission);
    setVendors(vendorData.vendors);
    // A food order is always bought from the shop the student chose; the server enforces it too.
    if (missionData.mission.shop) setVendorByItem(Object.fromEntries(missionData.mission.items.map((item: Item) => [item.id, missionData.mission.shop.id])));
    setQuantityByItem((current) => Object.fromEntries(missionData.mission.items.map((item: Item) => [item.id, current[item.id] ?? Math.max(1, item.quantity - sourcedQuantity(item))])));
    setPriceByItem((current) => Object.fromEntries(missionData.mission.items.map((item: Item) => [item.id, current[item.id] ?? item.unitPrice])));
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((e) => setError(e.message)); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    if (busy) return;
    // Delivered can't be undone, so ask before recording it.
    if (body.action === "delivered" && !window.confirm("Mark this order as delivered? Only do this once the student has it.")) return;
    if (body.action === "decline" && !window.confirm("Decline this mission? It goes to another runner and won't be offered to you again.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/runner/orders/${orderId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update mission.");
      if (body.action === "decline") { router.push("/runner"); return; }
      if (data.status === "REFUND_PROCESSING") {
        setMission((current) => current ? { ...current, status: "REFUND_PROCESSING", assignmentStatus: "CANCELLED" } : current);
        setNotice("The order needs a refund because an item couldn’t be sourced.");
      } else {
        await load();
        if (body.action === "delivery-issue") setNotice("Issue sent to PackAM operations.");
        if (body.action === "accept") setNotice("Mission accepted 🫡 It’s yours — start sourcing below.");
      }
      if (body.action === "delivery-issue") setIssueNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update mission.");
      // Reload so a lost race (another runner accepted first) doesn't leave a stale Accept button.
      await load().catch(() => setMission(null));
    } finally { setBusy(false); }
  }

  if (!mission) return <div className="mt-6 rounded-2xl bg-white p-5 text-sm" role={error ? "alert" : "status"}>{error || "Loading mission…"}{error && <div className="mt-3 flex flex-wrap gap-4"><button type="button" onClick={() => { setError(""); void load().catch((e) => setError(e.message)); }} className="min-h-11 font-bold underline underline-offset-4">Try again</button><Link href="/runner" className="inline-flex min-h-11 items-center font-bold underline underline-offset-4">← Missions</Link></div>}</div>;

  const noPendingPrice = mission.items.every((item) => !item.sourcing.some((source) => source.status === "PRICE_PENDING"));
  const readyToDeliver = noPendingPrice && mission.items.every((item) => sourcedQuantity(item) >= item.quantity);
  const unavailableNeedsResolution = noPendingPrice && mission.items.every((item) => sourcedQuantity(item) >= item.quantity || item.sourcing.some((source) => source.status === "UNAVAILABLE"));

  const display = mission.assignmentStatus === "OFFERED" ? { label: "New offer", tone: "warning" as const } : orderStatusDisplay(mission.status);
  const nextStep = runnerOrderNextStep(mission.status, mission.assignmentStatus);

  return <>
    <Link href="/runner" className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-black/60">← Missions</Link>
    <div className="mt-2 rounded-3xl border border-black/5 bg-white p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-wider text-black/40">📍 {mission.deliveryLocationLabel}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-black">{display.label}</h1><StatusBadge label={mission.assignmentStatus === "OFFERED" ? "Not yet accepted" : "Your mission"} tone={mission.assignmentStatus === "OFFERED" ? "neutral" : "success"} /></div>
      {nextStep && <p className="mt-3 rounded-xl bg-[#fffdf7] px-3 py-2 text-sm"><span className="font-black">Next: </span>{nextStep}</p>}
      {mission.assignmentStatus === "OFFERED" ? <>
        <p className="mt-3 text-sm text-black/60">{mission.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ")}</p>
        <button disabled={busy} onClick={() => void act({ action: "accept" })} className="mt-5 min-h-12 w-full rounded-full bg-black px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{busy ? "Accepting…" : "Accept mission"}</button>
        <button disabled={busy} onClick={() => void act({ action: "decline" })} className="mt-2 min-h-12 w-full rounded-full border border-black/15 px-6 py-3 text-sm font-bold disabled:opacity-50 sm:ml-2 sm:mt-5 sm:w-auto">Decline</button>
      </> : mission.status === "REFUND_PROCESSING" ? <p className="mt-3 text-sm text-black/60">PackAM operations will handle the refund request.</p> : <>
        {mission.status === "OUT_FOR_DELIVERY" && <div className="mt-4 rounded-2xl bg-[#fff8df] p-4"><p className="font-black">DELIVERY 🚴</p><DeliveryDestination label={mission.deliveryLocationLabel} address={mission.deliveryAddress} instructions={mission.deliveryInstructions} point={mission.deliveryPoint} />{mission.student?.phone && <p className="mt-2 text-sm"><strong>Contact:</strong> <a className="underline" href={`tel:${mission.student.phone}`}>{mission.student.firstName || "Student"} · {mission.student.phone}</a></p>}<ul className="mt-3 text-sm">{mission.items.map((item) => <li key={item.id}>{item.productName} × {item.quantity}</li>)}</ul><p className="mt-3 text-sm font-black">Total: ₦{mission.total?.toLocaleString()}</p></div>}
        {mission.status !== "OUT_FOR_DELIVERY" && <>
          <DeliveryDestination label={mission.deliveryLocationLabel} address={mission.deliveryAddress} instructions={mission.deliveryInstructions} point={mission.deliveryPoint} />
          {mission.student?.phone && <p className="mt-1 text-sm"><strong>Contact:</strong> <a className="underline" href={`tel:${mission.student.phone}`}>{mission.student.firstName || "Student"} · {mission.student.phone}</a></p>}
          <h2 className="mt-7 font-black">Shop list</h2>
          {mission.shop && <p className="mt-2 rounded-2xl bg-[#fff4c7] px-4 py-3 text-sm"><strong>Food order:</strong> buy everything from <strong>{mission.shop.name}</strong>{mission.shop.location ? ` · ${mission.shop.location}` : ""}. Don’t buy from another shop.</p>}
          <div className="mt-3 space-y-3">{mission.items.map((item) => {
            const remaining = Math.max(0, item.quantity - sourcedQuantity(item));
            return <section key={item.id} className="rounded-2xl bg-[#fffdf7] p-4">
              <div className="flex justify-between gap-3"><strong>{item.productName} × {item.quantity}</strong><span className="text-xs text-black/50">{remaining} left</span></div>
              {item.plate && <p className="mt-1 text-sm text-black/70">Plate: {item.plate}</p>}
              {item.sourcing.map((source) => <p key={source.id} className="mt-2 text-xs text-black/55">{source.status.replaceAll("_", " ")} · {source.orderSource.vendor.name}{source.actualUnitPrice !== null ? ` · ₦${source.actualUnitPrice.toLocaleString()}` : ""}</p>)}
              {remaining > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_90px_120px]">
                <label className="grid gap-1 text-xs font-bold text-black/70">Shop<select aria-label={`Shop for ${item.productName}`} className="min-h-11 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-normal text-black disabled:bg-black/5" value={vendorByItem[item.id] ?? ""} disabled={Boolean(mission.shop)} onChange={(event) => setVendorByItem({ ...vendorByItem, [item.id]: event.target.value })}><option value="">Choose shop</option>{(mission.shop ? [mission.shop] : vendors).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.location ? ` · ${vendor.location}` : ""}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-bold text-black/70">Qty<input aria-label={`Quantity sourced for ${item.productName}`} type="number" min="1" max={remaining} value={quantityByItem[item.id] ?? remaining} onChange={(event) => setQuantityByItem({ ...quantityByItem, [item.id]: Number(event.target.value) })} className="min-h-11 rounded-xl border border-black/10 px-3 py-2 text-sm font-normal text-black" /></label>
                <label className="grid gap-1 text-xs font-bold text-black/70">Unit price ₦<input aria-label={`Unit price for ${item.productName}`} type="number" min="0" value={priceByItem[item.id] ?? item.unitPrice} onChange={(event) => setPriceByItem({ ...priceByItem, [item.id]: Number(event.target.value) })} className="min-h-11 rounded-xl border border-black/10 px-3 py-2 text-sm font-normal text-black" /></label>
                <div className="flex flex-wrap gap-2 sm:col-span-3"><button disabled={busy || !vendorByItem[item.id]} onClick={() => void act({ action: "source", orderItemId: item.id, vendorId: vendorByItem[item.id], result: "AVAILABLE", quantity: quantityByItem[item.id], actualUnitPrice: priceByItem[item.id] })} className="min-h-11 rounded-full bg-black px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Record sourced</button>
                <button disabled={busy || !vendorByItem[item.id]} onClick={() => void act({ action: "source", orderItemId: item.id, vendorId: vendorByItem[item.id], result: "UNAVAILABLE" })} className="min-h-11 rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-40">Unavailable here</button></div>
              </div>}
            </section>;
          })}</div>
          {mission.status === "SOURCING_PRODUCT" && unavailableNeedsResolution && <button disabled={busy} onClick={() => void act({ action: "start-delivery" })} className="mt-5 min-h-12 w-full rounded-full bg-black px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{busy ? "Updating…" : readyToDeliver ? "Start delivery" : "Resolve unavailable items"}</button>}
        </>}
        {mission.status === "OUT_FOR_DELIVERY" && <>
          <button disabled={busy} onClick={() => void act({ action: "delivered" })} className="mt-5 min-h-12 w-full rounded-full bg-black px-6 py-3 text-sm font-black text-white disabled:opacity-50 sm:w-auto">{busy ? "Updating…" : "Mark delivered"}</button>
          <form className="mt-6 border-t border-black/5 pt-5" onSubmit={(event) => { event.preventDefault(); void act({ action: "delivery-issue", type: issueType, description: issueNote }); }}>
            <h2 className="font-black">Can&apos;t complete delivery?</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-[200px_1fr_auto]"><select aria-label="Issue type" className="min-h-11 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm" value={issueType} onChange={(event) => setIssueType(event.target.value as IssueType)}><option value="CUSTOMER_UNAVAILABLE">Customer unavailable</option><option value="DELIVERY_ISSUE">Delivery issue</option><option value="WRONG_ITEM">Wrong item</option><option value="MISSING_ITEM">Missing item</option><option value="DAMAGED_ITEM">Damaged item</option><option value="OTHER">Other</option></select><input aria-label="Short note for PackAM" value={issueNote} onChange={(event) => setIssueNote(event.target.value)} maxLength={1000} placeholder="Short note for PackAM" className="min-h-11 rounded-xl border border-black/10 px-3 py-2 text-sm"/><button disabled={busy} className="min-h-11 rounded-full border border-black/15 px-4 py-2 text-xs font-bold disabled:opacity-50">Report issue</button></div>
          </form>
        </>}
      </>}
    </div>
    {error && <p role="alert" className="mt-4 rounded-2xl bg-[#ffe9e7] p-4 text-sm text-[#c92d24]">{error}</p>}{notice && <p role="status" className="mt-4 rounded-2xl bg-[#e9f8ee] p-4 text-sm text-[#16803c]">{notice}</p>}
    <Link href="/runner" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-black/60">← Missions</Link>
  </>;
}
