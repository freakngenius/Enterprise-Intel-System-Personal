import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Enterprise AI Agent Demo",
  description: "A full-stack demo app powered by the OpenAI Agents SDK.",
  icons: {
    icon: "/brand-mark.svg?v=20260316",
    shortcut: "/brand-mark.svg?v=20260316",
    apple: "/brand-mark.svg?v=20260316",
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
