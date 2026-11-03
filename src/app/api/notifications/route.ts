import { auth } from "../../../auth";
import { db } from "../../../lib/db";
import { notificationOwnerWhere } from "../../../lib/notifications-policy";

/** The signed-in person's latest 50 notifications and their unread count. `?count=1`: the count only (the bell). */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to view notifications." }, { status: 401 });
  const active = await db.user.findFirst({ where: { id: session.user.id, status: "ACTIVE" }, select: { id: true } });
  if (!active) return Response.json({ error: "Your account is unavailable." }, { status: 403 });
  if (new URL(request.url).searchParams.get("count") === "1") {
    const unreadCount = await db.notification.count({ where: { ...notificationOwnerWhere(active.id), isRead: false } });
    return Response.json({ unreadCount }, { headers: { "Cache-Control": "no-store" } });
  }
  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({ where: notificationOwnerWhere(active.id), orderBy: { createdAt: "desc" }, take: 50, select: { id: true, type: true, title: true, message: true, orderId: true, relatedType: true, relatedId: true, isRead: true, createdAt: true } }),
    db.notification.count({ where: { ...notificationOwnerWhere(active.id), isRead: false } }),
  ]);
  return Response.json({ notifications, unreadCount });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to update notifications." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid notification request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid notification request." }, { status: 400 });
  const data = body as { id?: unknown; all?: unknown };
  if (data.all === true) {
    await db.notification.updateMany({ where: { ...notificationOwnerWhere(session.user.id), isRead: false }, data: { isRead: true } });
  } else if (typeof data.id === "string" && data.id.length <= 64) {
    await db.notification.updateMany({ where: { id: data.id, ...notificationOwnerWhere(session.user.id) }, data: { isRead: true } });
  } else return Response.json({ error: "Choose a notification to update." }, { status: 400 });
  return Response.json({ success: true });
}
