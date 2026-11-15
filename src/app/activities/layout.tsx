import type { Metadata } from "next";
import CrmShell from "../components/CrmShell";
import "./activities.css";

export const metadata: Metadata = {
  title: "Activities & Tasks | Myr CRM",
  description: "Manage CRM activities and tasks in one place.",
};

export default function ActivitiesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <CrmShell active="Activities">{children}</CrmShell>;
}
