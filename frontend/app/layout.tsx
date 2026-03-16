import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Enterprise AI Agent Demo",
  description: "A full-stack demo app powered by the OpenAI Agents SDK.",
  icons: {
    icon: "/brand-mark.png?v=20260316png",
    shortcut: "/brand-mark.png?v=20260316png",
    apple: "/brand-mark.png?v=20260316png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
