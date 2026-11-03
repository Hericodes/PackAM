import type { NextConfig } from "next";

/** Canonical production host (www); the apex redirects to it. */
const CANONICAL_ORIGIN = "https://www.packam.app";
const APEX_HOST = "packam.app";
/** PackAM's earlier address. It keeps serving, so apps installed from it keep working, but search engines drop it. */
const LEGACY_HOST = "packam.vercel.app";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Normally done by the Vercel domain settings before the app runs; this is the fallback. Query strings carry over.
      { source: "/:path*", has: [{ type: "host", value: APEX_HOST }], destination: `${CANONICAL_ORIGIN}/:path*`, permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: LEGACY_HOST }],
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        // The browser must re-check the service worker on every visit, so updates reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      // Pages and routes that receive one-time emailed tokens in the query string: never send that URL on as a
      // Referer, keep them out of search engines, and never cache them.
      ...["/reset-password", "/verify-email", "/confirm-email", "/api/account/verify-email", "/api/account/email/confirm"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      })),
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

export default nextConfig;