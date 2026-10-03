import { auth } from "../../../auth";
import { redirect } from "next/navigation";
import { NotificationList } from "../../../components/notifications/NotificationList";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fnotifications");
  return <NotificationList role={session.user.role} />;
}
