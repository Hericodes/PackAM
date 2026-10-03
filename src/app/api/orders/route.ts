import { auth } from "../../../auth";
import { db } from "../../../lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Sign in to view orders." }, { status: 401 });
  if (session.user.role !== "STUDENT") return Response.json({ error: "Student access required." }, { status: 403 });
  const orders = await db.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      total: true,
      currency: true,
      createdAt: true,
      items: { select: { productName: true, quantity: true } },
    },
  });
  return Response.json({ orders });
}
