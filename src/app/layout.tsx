import type { Metadata, Viewport } from "next";
import { WorkspaceAccessGate } from "./components/WorkspaceAccessGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Myr CRM | Workspace overview",
  description: "A preview of the Myr CRM sales workspace.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body><WorkspaceAccessGate>{children}</WorkspaceAccessGate></body>
    </html>
  );
}
