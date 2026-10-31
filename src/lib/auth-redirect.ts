export type PackamRole = "STUDENT" | "RUNNER" | "ADMIN";

export function roleHome(role: string): string {
  if (role === "RUNNER") return "/runner";
  if (role === "ADMIN") return "/admin";
  return "/";
}

/** Where a student may land after login: each section and everything under it. */
const STUDENT_SECTIONS = [
  "/search", "/checkout", "/cart", "/orders", "/product-requests",
  "/notifications", "/support", "/products",
  "/printing", "/food", "/account", "/saved",
];

function isAllowedForRole(role: string, pathname: string) {
  const inSection = (section: string) => pathname === section || pathname.startsWith(`${section}/`);
  if (role !== "STUDENT" && role !== "RUNNER" && role !== "ADMIN") return false;
  // Account settings are for every role.
  if (inSection("/settings")) return true;
  if (role === "ADMIN") return inSection("/admin");
  if (role === "RUNNER") return inSection("/runner");
  return pathname === "/" || STUDENT_SECTIONS.some(inSection);
}

/** Returns only a safe internal destination authorized for this authenticated role. */
export function resolvePostLoginDestination(role: string, candidate?: string | null): string {
  const fallback = roleHome(role);
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\u0000-\u001f\u007f]/.test(candidate) || /%(?:2f|5c)/i.test(candidate)) {
    return fallback;
  }

  try {
    const url = new URL(candidate, "https://packam.invalid");
    if (url.origin !== "https://packam.invalid" || !isAllowedForRole(role, url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
