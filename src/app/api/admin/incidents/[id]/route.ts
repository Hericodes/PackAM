import { auth } from "../../../../../auth";
import { db } from "../../../../../lib/db";
import { writeAuditLog } from "../../../../../lib/audit";
import { consumeRateLimit } from "../../../../../lib/rate-limit";

type Context = { params: Promise<{ id: string }> };
const transitions: Record<string, string[]> = { OPEN: ["INVESTIGATING", "RESOLVED"], INVESTIGATING: ["RESOLVED", "CLOSED"], RESOLVED: ["CLOSED"] };

export async function PATCH(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-incident:${session.user.id}`, 50, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid incident update." }, { status: 400 }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as { status?: unknown; resolution?: unknown } : {};
  const status = input.status;
  const resolution = typeof input.resolution === "string" ? input.resolution.trim().slice(0, 2000) : "";
  if (typeof status !== "string" || !["INVESTIGATING", "RESOLVED", "CLOSED"].includes(status) || (input.resolution !== undefined && typeof input.resolution !== "string")) return Response.json({ error: "Choose an incident status." }, { status: 400 });
  if (status === "RESOLVED" && resolution.length < 4) return Response.json({ error: "Add a short resolution note." }, { status: 400 });
  try {
    const updated = await db.$transaction(async (tx) => {
      const current = await tx.incident.findUnique({ where: { id }, select: { status: true, type: true, resolution: true } });
      if (!current) throw new Error("INCIDENT_NOT_FOUND");
      if (current.status !== status && !transitions[current.status]?.includes(status)) throw new Error("INVALID_TRANSITION");
      const result = await tx.incident.updateMany({ where: { id, status: current.status }, data: { status: status as "INVESTIGATING" | "RESOLVED" | "CLOSED", resolution: resolution || current.resolution } });
      if (!result.count) throw new Error("INCIDENT_CONFLICT");
      if (current.status !== status || (resolution && resolution !== current.resolution)) await writeAuditLog(tx, { actorId: session.user.id, action: "INCIDENT_STATUS_CHANGED", resource: "Incident", resourceId: id, previousState: { status: current.status, resolution: current.resolution }, newState: { status, resolution: resolution || current.resolution }, details: current.type });
      return { status, resolution: resolution || current.resolution };
    });
    return Response.json({ ok: true, incident: updated });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const statusCode = code === "INCIDENT_NOT_FOUND" ? 404 : code === "INVALID_TRANSITION" || code === "INCIDENT_CONFLICT" ? 409 : 500;
    if (statusCode === 500) console.error("ADMIN INCIDENT UPDATE ERROR:", code || "Unknown error");
    return Response.json({ error: statusCode === 404 ? "Incident not found." : statusCode === 409 ? "This incident changed or cannot move to that status." : "Unable to update this incident." }, { status: statusCode });
  }
}
