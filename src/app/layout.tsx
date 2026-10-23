import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { CartExperience } from "../components/cart/CartExperience";

/*
 * The old "Arial, Helvetica" stack looked different on every phone: Android has no Arial (it used Roboto or
 * the phone's own font), iPhones drew font-black headings as Arial Bold, Windows as Arial Black. One
 * self-hosted font with real weights up to 900 gives every device the same letters, weights and line breaks.
 * Roboto is what most Android visitors already saw.
 */
const sans = Roboto({ subsets: ["latin"], display: "swap", variable: "--font-packam" });

export const metadata: Metadata = {
  title: {
    default: "PackAM",
    template: "%s | PackAM",
  },
  description:
    "Need something but can't leave where you are? Order it. We'll get it to you.",
};

export const viewport: Viewport = {
  // Light is PackAM's only theme. "only light" also stops Chrome's auto-dark mode from repainting the site.
  colorScheme: "only light",
  // Lets env(safe-area-inset-*) report the notch and home-indicator areas, so fixed bars can avoid them.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sans.variable}>
      <body suppressHydrationWarning><CartExperience>{children}</CartExperience></body>
    </html>
  );
}
