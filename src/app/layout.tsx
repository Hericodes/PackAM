import type { Metadata } from "next";
import "./globals.css";
import { CartExperience } from "../components/cart/CartExperience";

export const metadata: Metadata = {
  title: {
    default: "PackAM",
    template: "%s | PackAM",
  },
  description:
    "Need something but can't leave where you are? Order it. We'll get it to you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning><CartExperience>{children}</CartExperience></body>
    </html>
  );
}
