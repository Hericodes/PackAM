import type { IconName } from "../ui/Icon";

export type NavRole = "STUDENT" | "RUNNER" | "ADMIN" | null;

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Extra path prefixes that should mark this item active (e.g. product pages under Shop). */
  match?: string[];
};

/**
 * Destinations are role-aware so nobody is shown a link that will only send them to /unauthorized.
 * `primary` sits in the navbar; `secondary` lives in the profile menu (desktop) and mobile sheet.
 * Settings (name, email, password, devices) is for every signed-in role.
 */
export function navItemsFor(role: NavRole): { primary: NavItem[]; secondary: NavItem[] } {
  const shop: NavItem = { href: "/search", label: "Shop", icon: "shop", match: ["/products"] };
  const printing: NavItem = { href: "/printing", label: "Printing", icon: "printer" };
  const saved: NavItem = { href: "/saved", label: "Saved", icon: "heart" };
  const support: NavItem = { href: "/support", label: "Help & support", icon: "help" };
  const settings: NavItem = { href: "/settings", label: "Settings", icon: "settings" };

  switch (role) {
    case "STUDENT":
      return {
        primary: [shop, printing, { href: "/orders", label: "My orders", icon: "package" }, saved],
        secondary: [
          { href: "/account", label: "Account", icon: "user" },
          { href: "/product-requests", label: "My requests", icon: "requests" },
          settings,
          support,
        ],
      };
    case "RUNNER":
      return { primary: [shop, printing, { href: "/runner", label: "Runner hub", icon: "truck" }], secondary: [settings, support] };
    case "ADMIN":
      return { primary: [shop, printing, { href: "/admin", label: "Operations", icon: "dashboard" }], secondary: [settings] };
    default:
      return { primary: [shop, printing, saved], secondary: [] };
  }
}

export function isNavItemActive(item: NavItem, pathname: string) {
  return [item.href, ...(item.match ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
