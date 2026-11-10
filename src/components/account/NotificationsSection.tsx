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
 * Honest about what exists: every notification is in-app. Students can also get some by email once the email tables
 * exist (`emailChoices`): their switches are in the "Emails from PackAM" section below. Runners and admins get no
 * automated email, and nobody gets SMS or push. No hooks, so it renders on the server.
 */
export function NotificationsSection({ role, emailChoices = false }: { role: Role; emailChoices?: boolean }) {
  const { what, place } = COPY[role];
  return (
    <SettingsSection id="notifications" icon="bell" title="Notifications">
      <p className="text-sm leading-6 text-black/75">
        {what} appear in <span className="font-bold text-black">{place}</span>, under the bell in the app.
      </p>
      <p className="mt-2 text-sm leading-6 text-black/75">
        {role === "STUDENT" && emailChoices
          ? "Order updates can come by email too. Choose which emails you get in “Emails from PackAM” below. PackAM doesn’t send SMS."
          : "PackAM doesn’t send these by email or SMS, so there’s nothing to turn on or off here."}
      </p>
      <Link href="/notifications" className="pk-btn pk-btn-secondary mt-4">
        <Icon name="bell" className="h-4 w-4" />
        Open {place}
      </Link>
    </SettingsSection>
  );
}
