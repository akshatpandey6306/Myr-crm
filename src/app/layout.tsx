import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Activities & Tasks | Myr CRM",
  description: "Manage CRM activities and tasks in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
