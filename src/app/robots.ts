import type { MetadataRoute } from "next";
import { siteConfig } from "../config/site";

/**
 * robots.txt: the public pages are open to search engines; accounts, checkout, orders, staff areas, the API and
 * the pages emailed links land on are not. The sitemap is on the canonical www domain, whichever host serves this.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/runner", "/account", "/settings", "/checkout", "/orders", "/saved", "/notifications", "/printing/jobs", "/printing/payment", "/reset-password", "/verify-email", "/confirm-email"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
