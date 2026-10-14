import { auth } from "../../../../../auth";
import { consumeRateLimit } from "../../../../../lib/rate-limit";
import {
  acceptPrintMission,
  advancePrintMission,
  getRunnerPrintMission,
  PrintMissionError,
  reportPrintMissionIssue,
} from "../../../../../lib/printing/runner-service";
import { isPrintMissionIssueAction, isPrintMissionStepAction } from "../../../../../lib/printing/runner-mission-policy";

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown, label: string) {
  if (error instanceof PrintMissionError) return Response.json({ error: error.message }, { status: error.status });
  console.error(label, error instanceof Error ? error.name : "Unknown error");
  return Response.json({ error: "Unable to update this print mission. Try again." }, { status: 500 });
}

export async function GET(_request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  const { id } = await context.params;
  try {
    return Response.json({ mission: await getRunnerPrintMission(session.user.id, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "RUNNER PRINT MISSION LOAD ERROR:");
  }
}

export async function POST(request: Request, context: Context) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (session.user.role !== "RUNNER") return Response.json({ error: "Runner access required." }, { status: 403 });
  const rate = await consumeRateLimit(`runner-print-action:${session.user.id}`, 30, 60_000);
  if (!rate.allowed) {
    return Response.json({ error: "Too many updates. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const { id } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid mission action." }, { status: 400 }); }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as { action?: unknown; note?: unknown } : {};
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 1000)) {
    return Response.json({ error: "Keep the note under 1000 characters." }, { status: 400 });
  }

  try {
    if (input.action === "accept") return Response.json(await acceptPrintMission(session.user.id, id));
    if (isPrintMissionStepAction(input.action)) return Response.json(await advancePrintMission(session.user.id, id, input.action));
    if (isPrintMissionIssueAction(input.action) || input.action === "delivery-issue") {
      return Response.json(await reportPrintMissionIssue(session.user.id, id, input.action, input.note));
    }
    return Response.json({ error: "Unknown mission action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error, "RUNNER PRINT MISSION ACTION ERROR:");
  }
}
