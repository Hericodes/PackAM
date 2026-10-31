import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/Icon";

type SettingsSectionProps = {
  /** The anchor (/settings#email) and the base of the heading's id. */
  id: string;
  icon: IconName;
  title: ReactNode;
  description?: ReactNode;
  /** "danger" tints the badge and border for the account deletion card. */
  tone?: "default" | "danger";
  children: ReactNode;
};

/**
 * One card on the settings page: an icon badge, the section's h2 and a line about what it's for, then its content.
 * No hooks, so it works in server and client components alike.
 */
export function SettingsSection({ id, icon, title, description, tone = "default", children }: SettingsSectionProps) {
  const headingId = `${id}-heading`;
  const danger = tone === "danger";
  return (
    <section id={id} aria-labelledby={headingId} className={`pk-card scroll-mt-6 p-5 sm:p-7 ${danger ? "border-packam-error/20" : ""}`}>
      <div className="flex items-start gap-3.5">
        <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] ${danger ? "bg-packam-error-light text-packam-error" : "bg-packam-yellow-light text-black"}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={headingId} className="text-lg font-black leading-6 tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-1 text-pretty text-sm leading-6 text-black/65">{description}</p>}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
