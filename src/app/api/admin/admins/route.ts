import { adminApiAccess } from "../../../../lib/admin/admin-access";
import { promoteToAdmin, removeAdmin } from "../../../../lib/admin/admin-management";

export const runtime = "nodejs";

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Super admin only: make an existing account an admin. Body { email }. */
export async function POST(request: Request) {
  const allowed = await adminApiAccess({ superOnly: true });
  if (!allowed.ok) return allowed.response;
  const body = await readBody(request);
  if (!body) return Response.json({ error: "Enter the email address they use for PackAM." }, { status: 400 });
  try {
    const result = await promoteToAdmin(allowed.access, body.email);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("ADMIN ADD ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t add that admin. Try again." }, { status: 500 });
  }
}

/** Super admin only: remove an admin. Body { userId, role: "STUDENT" | "RUNNER" }. */
export async function DELETE(request: Request) {
  const allowed = await adminApiAccess({ superOnly: true });
  if (!allowed.ok) return allowed.response;
  const body = await readBody(request);
  if (!body) return Response.json({ error: "Choose who to remove." }, { status: 400 });
  try {
    const result = await removeAdmin(allowed.access, body.userId, body.role);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error("ADMIN REMOVE ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t remove that admin. Try again." }, { status: 500 });
  }
}
