import { auth } from "../../../auth";
import { resolvePostLoginDestination } from "../../../lib/auth-redirect";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.role) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const candidate = new URL(request.url).searchParams.get("callbackUrl");
  const destination = resolvePostLoginDestination(session.user.role, candidate);
  return Response.json({ destination }, { headers: { "Cache-Control": "private, no-store" } });
}
