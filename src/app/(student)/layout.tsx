import { auth } from "../../auth";
import { NotificationBell } from "../../components/notifications/NotificationBell";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return <>{session?.user && <div className="border-b border-black/5 bg-white"><div className="packam-container flex justify-end py-1"><NotificationBell /></div></div>}{children}</>;
}
