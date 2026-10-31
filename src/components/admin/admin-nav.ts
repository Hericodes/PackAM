import type { IconName } from "../ui/Icon";

/**
 * Every admin destination, grouped by task. The sidebar (desktop) and the drawer (phones) both render this
 * list, so nothing is reachable in one and missing in the other. Each page and API still checks permissions
 * on its own; this is navigation only.
 */
export type AdminNavItem = { href: string; label: string; icon: IconName };
export type AdminNavGroup = { label: string | null; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [
    { href: "/admin", label: "Overview", icon: "dashboard" },
    { href: "/admin/analytics", label: "Analytics", icon: "chart" },
  ] },
  { label: "Operations", items: [
    { href: "/admin/orders", label: "Orders", icon: "package" },
    { href: "/admin/print-jobs", label: "Print jobs", icon: "printer" },
    { href: "/admin/exceptions", label: "Exceptions", icon: "alert" },
    { href: "/admin/payments", label: "Payments", icon: "card" },
    // Reviews and reconciliation are a section of the Payments page.
    { href: "/admin/payments#review-open", label: "Payment reviews", icon: "shieldCheck" },
    { href: "/admin/requests", label: "Product requests", icon: "requests" },
  ] },
  { label: "Catalogue", items: [
    { href: "/admin/products", label: "Products", icon: "shop" },
    { href: "/admin/food", label: "Food", icon: "food" },
    { href: "/admin/categories", label: "Categories", icon: "grid" },
    { href: "/admin/labels", label: "Labels", icon: "tag" },
    { href: "/admin/vendors", label: "Vendors & sources", icon: "store" },
  ] },
  { label: "Management", items: [
    { href: "/admin/runners", label: "Runners", icon: "truck" },
    { href: "/admin/support", label: "Support", icon: "message" },
    { href: "/admin/finance", label: "Finance", icon: "wallet" },
    { href: "/admin/audit", label: "Audit log", icon: "history" },
  ] },
  { label: "Other views", items: [
    { href: "/search", label: "Marketplace", icon: "cart" },
    { href: "/runner", label: "Runner view", icon: "arrowUpRight" },
  ] },
];

/** The current page's item. A section link (#…) is never "current"; its page is. */
export function isAdminNavActive(href: string, pathname: string) {
  if (href.includes("#")) return false;
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}
