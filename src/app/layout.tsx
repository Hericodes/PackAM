import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { CartExperience } from "../components/cart/CartExperience";
import { PwaProvider } from "../components/pwa/PwaProvider";
import { PageViewTracker } from "../components/analytics/PageViewTracker";

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
  applicationName: "PackAM",
  // Installed on iPhone and iPad (Add to Home Screen): opens full screen, named PackAM. The icon is app/apple-icon.png.
  appleWebApp: { capable: true, title: "PackAM", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Light is PackAM's only theme. "only light" also stops Chrome's auto-dark mode from repainting the site.
  colorScheme: "only light",
  // Lets env(safe-area-inset-*) report the notch and home-indicator areas, so fixed bars can avoid them.
  viewportFit: "cover",
  // The browser bar and installed app's title bar match the cream page background.
  themeColor: "#fffdf7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sans.variable}>
      <body suppressHydrationWarning><CartExperience><PwaProvider>{children}</PwaProvider></CartExperience><PageViewTracker /></body>
    </html>
  );
}
