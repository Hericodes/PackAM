import type { MetadataRoute } from "next";
import { siteConfig } from "../config/site";

/** The public pages worth finding in search, on the canonical www domain. Shop and product pages are reached from these. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/search", "/food", "/printing"].map((path) => ({
    url: `${siteConfig.url}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "daily",
    priority: path === "/" ? 1 : 0.8,
  }));
}
