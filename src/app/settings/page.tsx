import Link from 'next/link';

const sections = [
  { title: 'General', description: 'Workspace name, currency, time zone, and week start.', href: '/settings/general' },
  { title: 'Leads', description: 'Review the lead sources and statuses currently supported by this workspace.', href: '/settings/leads' },
  { title: 'Roles', description: 'Review workspace roles and their current access boundaries.', href: '/settings/roles' },
  { title: 'Users', description: 'Invite teammates and manage workspace membership and roles.', href: '/settings/users' },
];

export default function SettingsPage() {
  return (
    <main className="settings-route-content">
      <p className="welcome-copy">Manage workspace preferences, lead configuration, and team access.</p>
      <div className="settings-route-grid">
        {sections.map((section) => (
          <Link className="settings-route-card" href={section.href} key={section.href}>
            <h2>{section.title}</h2>
            <p>{section.description}</p>
            <span>Open settings →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
