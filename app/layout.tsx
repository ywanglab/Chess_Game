import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Castle — multiplayer chess",
  description: "Create a private chess table and play live with a friend.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
