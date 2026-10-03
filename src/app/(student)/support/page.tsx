import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { SupportCenter } from "../../../components/support/SupportCenter";

export default async function SupportPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fsupport");
  if (session.user.role === "ADMIN") redirect("/admin/support");
  return <SupportCenter />;
}
