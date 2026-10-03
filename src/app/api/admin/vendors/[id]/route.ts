import { VendorStatus, VendorType } from "@prisma/client";
import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-vendor:${session.user.id}`, 40, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many shop changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown; try { body = await request.json(); } catch { return Response.json({ error: "Invalid shop details." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid shop details." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (input.status !== undefined && Object.values(VendorStatus).includes(input.status as VendorStatus)) data.status = input.status;
  if (input.type !== undefined && Object.values(VendorType).includes(input.type as VendorType)) data.type = input.type;
  for (const key of ["name", "location", "phone", "notes"] as const) if (input[key] !== undefined && (input[key] === null || typeof input[key] === "string")) data[key] = typeof input[key] === "string" ? input[key].trim() || null : null;
  if (input.reliabilityScore !== undefined) {
    const score = input.reliabilityScore === null || input.reliabilityScore === "" ? null : Number(input.reliabilityScore);
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 5)) return Response.json({ error: "Reliability must be between 0 and 5." }, { status: 400 });
    data.reliabilityScore = score;
  }
  if (!Object.keys(data).length) return Response.json({ error: "No valid shop changes provided." }, { status: 400 });
  try { const vendor = await db.$transaction(async (tx) => { const before = await tx.vendor.findUnique({ where: { id }, select: { name: true, type: true, location: true, phone: true, notes: true, status: true, reliabilityScore: true } }); if (!before) throw new Error("NOT_FOUND"); const next = await tx.vendor.update({ where: { id }, data: data as never, select: { id: true, name: true, type: true, location: true, phone: true, notes: true, status: true, reliabilityScore: true } }); await writeAuditLog(tx, { actorId: session.user.id, action: "VENDOR_UPDATED", resource: "Vendor", resourceId: id, previousState: before, newState: next }); return next; }); return Response.json({ vendor }); }
  catch { return Response.json({ error: "Shop not found or update invalid." }, { status: 404 }); }
}
