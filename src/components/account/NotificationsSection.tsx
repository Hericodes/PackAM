import Link from "next/link";
import { Icon } from "../ui/Icon";
import { SettingsSection } from "./SettingsSection";

type Role = "STUDENT" | "RUNNER" | "ADMIN";

/** What each role hears about, and what the app calls the list (Operations calls it Updates). */
const COPY: Record<Role, { what: string; place: string }> = {
  STUDENT: { what: "Updates about your orders, print jobs and requests", place: "Notifications" },
  RUNNER: { what: "New missions and updates about your deliveries", place: "Notifications" },
  ADMIN: { what: "Alerts about orders, payments and support requests", place: "Updates" },
};

/**
 * Honest about what exists: every notification is in-app and operational (order, payment, delivery and support
 * updates), and there's no email, SMS or push channel, so there are no switches to show. No hooks, so it renders
 * on the server.
 */
export function NotificationsSection({ role }: { role: Role }) {
  const { what, place } = COPY[role];
  return (
    <SettingsSection id="notifications" icon="bell" title="Notifications">
      <p className="text-sm leading-6 text-black/75">
        {what} appear in <span className="font-bold text-black">{place}</span>, under the bell in the app.
      </p>
      <p className="mt-2 text-sm leading-6 text-black/75">
        PackAM doesn’t send notifications by email or SMS yet, so there’s nothing to turn on or off here.
      </p>
      <Link href="/notifications" className="pk-btn pk-btn-secondary mt-4">
        <Icon name="bell" className="h-4 w-4" />
        Open {place}
      </Link>
    </SettingsSection>
  );
}
