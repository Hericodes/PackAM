import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { createNotification } from "../../../../../lib/notifications";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { canTransitionSupportCase } from "../../../../../lib/support-policy";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const limit = await consumeRateLimit(`admin-support:${session.user.id}`, 50, 60_000);
  if (!limit.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid support update." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid support update." }, { status: 400 });
  const input = body as { status?: unknown; resolution?: unknown };
  if (typeof input.status !== "string" || !["IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"].includes(input.status) || (input.resolution !== undefined && typeof input.resolution !== "string")) return Response.json({ error: "Choose a valid support status." }, { status: 400 });
  const resolution = typeof input.resolution === "string" ? input.resolution.trim().slice(0, 2000) : "";
  if (input.status === "RESOLVED" && resolution.length < 4) return Response.json({ error: "Add a short resolution before closing this issue." }, { status: 400 });
  try {
    const result = await db.$transaction(async (tx) => {
      const current = await tx.supportCase.findUnique({ where: { id }, select: { id: true, userId: true, status: true, subject: true, resolution: true } });
      if (!current) throw new Error("CASE_NOT_FOUND");
      if (!canTransitionSupportCase(current.status, input.status as string)) throw new Error("INVALID_TRANSITION");
      const updated = await tx.supportCase.updateMany({ where: { id, status: current.status }, data: { status: input.status as "IN_PROGRESS" | "ESCALATED" | "RESOLVED" | "CLOSED", resolution: resolution || current.resolution, handledById: session.user.id } });
      if (!updated.count) throw new Error("CASE_CONFLICT");
      const next = { status: input.status as string, resolution: resolution || current.resolution };
      await writeAuditLog(tx, { actorId: session.user.id, action: "SUPPORT_CASE_UPDATED", resource: "SupportCase", resourceId: id, previousState: { status: current.status, resolution: current.resolution }, newState: next });
      if (current.status !== input.status) await createNotification(tx, { userId: current.userId, type: "SYSTEM", title: input.status === "RESOLVED" ? "Support update" : "We’re looking into it", message: input.status === "RESOLVED" ? `We reviewed “${current.subject}”: ${resolution}` : "PackAM operations is looking into your request.", relatedType: "SUPPORT_CASE", relatedId: id, idempotencyKey: `support:${id}:${input.status}` });
      return { id, ...next };
    });
    return Response.json({ case: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "CASE_NOT_FOUND" ? 404 : code === "INVALID_TRANSITION" || code === "CASE_CONFLICT" ? 409 : 500;
    if (status === 500) console.error("ADMIN SUPPORT UPDATE ERROR:", code || "Unknown error");
    return Response.json({ error: status === 404 ? "Support case not found." : status === 409 ? "This case changed or cannot move to that status." : "Unable to update support case." }, { status });
  }
}
