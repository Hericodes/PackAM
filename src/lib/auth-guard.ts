import { redirect } from "next/navigation";
import { auth } from "../auth";

type UserRole = "STUDENT" | "RUNNER" | "ADMIN";

export async function requireAuth(returnTo?: string) {
  const session = await auth();
  if (!session?.user) {
    const callback = returnTo ? `?callbackUrl=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${callback}`);
  }
  return session;
}

export async function requireRole(role: UserRole, returnTo?: string) {
  const session = await requireAuth(returnTo);
  // ADMIN can view any role's application surface. API mutation and ownership
  // checks still run independently and are never bypassed here.
  if (session.user.role !== role && session.user.role !== "ADMIN") redirect("/unauthorized");
  return session;
}
