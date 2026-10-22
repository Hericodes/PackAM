import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import { setRunnerVerification } from "../../../../../lib/runners/runner-admin";

type Context = { params: Promise<{ id: string }> };

/** Operations sets up/verifies or un-verifies a runner account (`id` is the user id). Admin only. */
export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return Response.json({ error: "Admin access required." }, { status: 403 });
  const rate = await consumeRateLimit(`admin-runner:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Too many changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const { id } = await context.params;
  if (!id || id.length > 100) return Response.json({ error: "Runner not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose verify or unverify." }, { status: 400 }); }
  const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
  if (action !== "verify" && action !== "unverify") return Response.json({ error: "Choose verify or unverify." }, { status: 400 });
  try {
    const result = await setRunnerVerification(session.user.id, id, action === "verify");
    if (result.kind === "NOT_FOUND") return Response.json({ error: "Runner not found." }, { status: 404 });
    if (result.kind === "NOT_A_RUNNER") return Response.json({ error: "Only an active runner account can be set up or verified. This action never changes a user's role." }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    console.error("ADMIN RUNNER ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "The runner couldn’t be updated. Nothing was changed — try again." }, { status: 500 });
  }
}
