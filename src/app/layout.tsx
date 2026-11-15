import type { Metadata, Viewport } from "next";
import CrmThemeProvider from "./components/CrmThemeProvider";
import { WorkspaceAccessGate } from "./components/WorkspaceAccessGate";
import { WorkspaceModuleAccessProvider } from "./components/WorkspaceModuleAccess";
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
      <body><CrmThemeProvider><WorkspaceAccessGate><WorkspaceModuleAccessProvider>{children}</WorkspaceModuleAccessProvider></WorkspaceAccessGate></CrmThemeProvider></body>
    </html>
  );
}
