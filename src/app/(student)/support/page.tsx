import type { Metadata } from "next";
import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { SupportCenter } from "../../../components/support/SupportCenter";
import { db } from "../../../lib/db";
import { formatCampusTime, orderStatusLabel, shortReference } from "../../../lib/student-copy";

export const metadata: Metadata = { title: "Help & support" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const session = await auth();
  const { order } = await searchParams;
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(order ? `/support?order=${encodeURIComponent(order)}` : "/support")}`);
  if (session.user.role === "ADMIN") redirect("/admin/support");

  // Students pick from their own orders; the API re-checks ownership on submit.
  const orders = session.user.role === "STUDENT"
    ? await db.order.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { id: true, status: true, createdAt: true, items: { select: { productName: true }, take: 2 } },
      })
    : null;

  const orderOptions = orders?.map((row) => ({
    id: row.id,
    label: `${shortReference(row.id)} · ${row.items.map((item) => item.productName).join(", ") || "Order"} · ${orderStatusLabel(row.status)} · ${formatCampusTime(row.createdAt)}`,
  })) ?? null;
  const initialOrderId = orderOptions?.some((row) => row.id === order) ? order! : "";

  return <SupportCenter orders={orderOptions} initialOrderId={initialOrderId} />;
}
