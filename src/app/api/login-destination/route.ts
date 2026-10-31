import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { resolvePostLoginDestination } from "../../../lib/auth-redirect";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.role || !session.user.id) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const candidate = new URL(request.url).searchParams.get("callbackUrl");
  const destination = resolvePostLoginDestination(session.user.role, candidate);
  // The first name for the welcome as stored (splitting the display name is wrong for two-word first names). The
  // greeting is decoration: if this can't be read, the sign-in still goes ahead without it.
  const firstName = await db.user.findUnique({ where: { id: session.user.id }, select: { firstName: true } })
    .then((user) => user?.firstName?.trim() || null)
    .catch(() => null);
  return Response.json({ destination, firstName }, { headers: { "Cache-Control": "private, no-store" } });
}
