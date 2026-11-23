import type { Metadata, Viewport } from "next";
import CrmThemeProvider from "./components/CrmThemeProvider";
import { WorkspaceAccessGate } from "./components/WorkspaceAccessGate";
import { WorkspaceModuleAccessProvider } from "./components/WorkspaceModuleAccess";
import "./globals.css";

// Request-bound CSP nonces must be attached during server rendering rather than static prerendering.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "LeadPilot | Workspace overview",
  description: "LeadPilot customer relationship and sales workspace.",
  icons: {
    icon: "/advance-solution-logo.svg",
    apple: "/advance-solution-logo.svg",
  },
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
