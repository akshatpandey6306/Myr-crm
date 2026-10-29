import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Myr CRM | Workspace overview",
  description: "A preview of the Myr CRM sales workspace.",
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