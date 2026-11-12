/**
 * How a notification is shown: its icon and colour, where tapping it goes, its time ("5 min ago") and which day group
 * it sits in. Pure (no React, no server code), so the bell, the list and the tests share one set of rules.
 * Times are campus time (Africa/Lagos, UTC+1, no daylight saving).
 */
import type { IconName } from "../components/ui/Icon";

export type NotificationRole = "STUDENT" | "RUNNER" | "ADMIN";
export type NotificationEntry = { type: string; title: string; orderId: string | null; relatedType: string | null; relatedId: string | null };

export type NotificationLook = { icon: IconName; label: string; tile: string };

/** One look per type; anything unknown reads as a general update. Tiles are a soft background with dark ink. */
const LOOKS: Record<string, NotificationLook> = {
  ORDER: { icon: "package", label: "Order", tile: "bg-[#fff4c7] text-[#7a4a00]" },
  PAYMENT: { icon: "wallet", label: "Payment", tile: "bg-[#e8f6ec] text-[#16572b]" },
  DELIVERY: { icon: "truck", label: "Delivery", tile: "bg-[#e7f0fb] text-[#1d4f8a]" },
  PRODUCT_REQUEST: { icon: "requests", label: "Request", tile: "bg-[#f3ecfb] text-[#5b2f8a]" },
  ACCOUNT: { icon: "user", label: "Account", tile: "bg-[#efefef] text-[#333333]" },
  SYSTEM: { icon: "shieldCheck", label: "PackAM", tile: "bg-[#efefef] text-[#333333]" },
};

export function notificationLook(type: string): NotificationLook {
  return LOOKS[type] ?? LOOKS.SYSTEM;
}

/** Where tapping the notification goes, for this reader's role; null when there's nothing to open. */
export function notificationHref(item: NotificationEntry, role: NotificationRole): string | null {
  if (item.orderId) return role === "ADMIN" ? `/admin/orders/${item.orderId}` : role === "RUNNER" ? `/runner/missions/${item.orderId}` : `/orders/${item.orderId}`;
  if (item.relatedType === "PRINT_JOB" && item.relatedId) {
    return role === "ADMIN" ? `/admin/print-jobs/${item.relatedId}` : role === "RUNNER" ? `/runner/print-missions/${item.relatedId}` : `/printing/jobs/${item.relatedId}`;
  }
  if (item.relatedType === "PRODUCT_REQUEST") return role === "ADMIN" ? "/admin/requests" : "/product-requests";
  if (item.relatedType === "SUPPORT_CASE") return role === "ADMIN" ? "/admin/support" : "/support";
  // Students: cashback they earned lives in Settings.
  if (item.relatedType === "CASHBACK") return role === "STUDENT" ? "/settings#cashback" : null;
  // Students: an order an admin placed for them, waiting for their payment (relatedId is the payment reference).
  if (role === "STUDENT" && item.relatedType === "PAYMENT" && item.relatedId) return `/checkout/payment-result?reference=${encodeURIComponent(item.relatedId)}`;
  // Admins: bank transfers to confirm, payment problems and payment-PIN alerts all live on the Payments page.
  if (role === "ADMIN" && (item.type === "PAYMENT" || item.relatedType === "USER")) return "/admin/payments";
  // Students: a payment that didn't go through leaves the cart as it was.
  if (role === "STUDENT" && item.type === "PAYMENT") return "/cart";
  return null;
}

/** The link's words, for screen readers and the small action hint. */
export function notificationActionLabel(href: string | null) {
  if (!href) return null;
  if (href.includes("/orders/") || href.includes("/missions/")) return "Open order";
  if (href.startsWith("/checkout/payment-result")) return "Pay for your order";
  if (href === "/settings#cashback") return "See your cashback";
  if (href.includes("print")) return "Open print job";
  if (href.includes("requests")) return "View request";
  if (href.includes("support")) return "Open support";
  if (href === "/admin/payments") return "Open payments";
  if (href === "/cart") return "Go to cart";
  return "Open";
}

const CAMPUS_OFFSET_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** Whole days since 1970 in campus time, so "today" turns over at campus midnight. */
const campusDay = (date: Date) => Math.floor((date.getTime() + CAMPUS_OFFSET_MS) / DAY_MS);

/** "Just now", "5 min ago", "3 h ago", "Yesterday", "Mon", then "12 Oct" (and the year once it isn't this year). */
export function relativeTime(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const days = campusDay(now) - campusDay(at);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Africa/Lagos" });
  const sameYear = at.toLocaleDateString("en-GB", { year: "numeric", timeZone: "Africa/Lagos" }) === now.toLocaleDateString("en-GB", { year: "numeric", timeZone: "Africa/Lagos" });
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "Africa/Lagos" });
}

/** The full time, for the tooltip and screen readers: "Tue 3 Nov, 14:05". */
export function fullTime(at: Date) {
  return at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });
}

export type DayGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function dayGroup(at: Date, now: Date): DayGroup {
  const days = campusDay(now) - campusDay(at);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  return "Earlier";
}

/** Newest first, split into day groups in order; empty groups are left out. */
export function groupByDay<T extends { createdAt: string }>(items: readonly T[], now: Date): Array<{ group: DayGroup; items: T[] }> {
  const order: DayGroup[] = ["Today", "Yesterday", "This week", "Earlier"];
  const groups = new Map<DayGroup, T[]>();
  for (const item of [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const group = dayGroup(new Date(item.createdAt), now);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return order.filter((group) => groups.has(group)).map((group) => ({ group, items: groups.get(group)! }));
}
