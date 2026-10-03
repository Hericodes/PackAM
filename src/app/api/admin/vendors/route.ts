import { VendorType } from "@prisma/client";
import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";
import { writeAuditLog } from "../../../../lib/audit";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-vendor:${session.user.id}`, 40, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many shop changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Enter a shop name." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Enter a shop name." }, { status: 400 });
  const input = body as { name?: unknown; type?: unknown; location?: unknown; phone?: unknown; notes?: unknown; reliabilityScore?: unknown };
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 120 || !Object.values(VendorType).includes(input.type as VendorType)) return Response.json({ error: "Enter a name and choose a shop type." }, { status: 400 });
  if ([input.location, input.phone, input.notes].some((value) => value !== undefined && value !== null && typeof value !== "string")) return Response.json({ error: "Check shop details." }, { status: 400 });
  const score = input.reliabilityScore === "" || input.reliabilityScore === null || input.reliabilityScore === undefined ? null : Number(input.reliabilityScore);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 5)) return Response.json({ error: "Reliability must be between 0 and 5." }, { status: 400 });
  const vendor = await db.$transaction(async (tx) => { const item = await tx.vendor.create({ data: { name, type: input.type as VendorType, location: (input.location as string | undefined)?.trim() || null, phone: (input.phone as string | undefined)?.trim() || null, notes: (input.notes as string | undefined)?.trim() || null, reliabilityScore: score }, select: { id: true, name: true, type: true, location: true, status: true, reliabilityScore: true } }); await writeAuditLog(tx, { actorId: session.user.id, action: "VENDOR_CREATED", resource: "Vendor", resourceId: item.id, newState: item }); return item; });
  return Response.json({ vendor }, { status: 201 });
}
