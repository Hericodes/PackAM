export type PackamRole = "STUDENT" | "RUNNER" | "ADMIN";

export function roleHome(role: string): string {
  if (role === "RUNNER") return "/runner";
  if (role === "ADMIN") return "/admin";
  return "/";
}

function isAllowedForRole(role: string, pathname: string) {
  const inSection = (section: string) => pathname === section || pathname.startsWith(`${section}/`);
  if (role === "ADMIN") return inSection("/admin");
  if (role === "RUNNER") return inSection("/runner");
  if (role !== "STUDENT") return false;
  return pathname === "/" || [
    "/search", "/checkout", "/cart", "/orders", "/product-requests",
    "/notifications", "/support", "/products",
  ].some(inSection);
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
