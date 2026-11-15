import { notFound } from 'next/navigation';
import ControlPanelPage, { type ControlPanelSection } from '../page';

const sections = new Set<ControlPanelSection>([
  'onboarding',
  'plans',
  'approvals',
  'provisioning',
  'partners',
  'workspaces',
  'audit-log',
]);

export default async function ControlPanelSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.has(section as ControlPanelSection)) notFound();
  return <ControlPanelPage section={section as ControlPanelSection} />;
}
