import type { MetadataRoute } from "next";

/**
 * Makes PackAM installable. The installed app is the same website (same accounts, cart, orders and payments),
 * opened in its own window. Icons are the PackAM logo resized; nothing here is a separate brand.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PackAM",
    short_name: "PackAM",
    description: "Need something but can't leave where you are? Order it. We'll get it to you.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffdf7",
    theme_color: "#fffdf7",
    categories: ["shopping", "food", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Order Stuff", url: "/search", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Printing", url: "/printing", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My orders", url: "/orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
