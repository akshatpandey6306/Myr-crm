import Link from 'next/link';
import CrmShell from '../components/CrmShell';
import './settings.css';

const settingsSections = [
  { label: 'Overview', href: '/settings' },
  { label: 'General', href: '/settings/general' },
  { label: 'Leads', href: '/settings/leads' },
  { label: 'Roles', href: '/settings/roles' },
  { label: 'Users', href: '/settings/users' },
];

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <CrmShell active="Settings">
      <div className="settings-route">
        <header className="settings-route-header">
          <div className="settings-route-title">
            <div>
              <p className="date-label">WORKSPACE / SETTINGS</p>
              <h1>Settings</h1>
            </div>
            <Link className="settings-back-to-crm" href="/">Back to CRM</Link>
          </div>
          <nav aria-label="Settings sections">
            {settingsSections.map((section) => (
              <Link key={section.href} href={section.href}>{section.label}</Link>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </CrmShell>
  );
}
