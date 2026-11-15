'use client';

import Link from 'next/link';
import { useContext } from 'react';
import { SettingsTeamAccessContext } from './layout';

const sections = [
  { title: 'General', description: 'Workspace name, currency, time zone, and week start.', href: '/settings/general' },
  { title: 'Leads', description: 'Review the lead sources and statuses currently supported by this workspace.', href: '/settings/leads' },
  { title: 'Roles', description: 'Review workspace roles and their current access boundaries.', href: '/settings/roles' },
  { title: 'Users', description: 'Invite teammates and manage workspace membership and roles.', href: '/settings/users' },
  { title: 'Security & devices', description: 'Review active sign-in sessions and sign out sessions you no longer use.', href: '/settings/security' },
  { title: 'Workspace control', description: 'Manage employee access to plan modules and view the private employee join code.', href: '/settings/workspace' },
  { title: 'Subscription', description: 'View this workspace’s plan, included modules, and renewal options.', href: '/subscription' },
];

export default function SettingsPage() {
  const { canManageTeam } = useContext(SettingsTeamAccessContext);

  return (
    <main className="settings-route-content">
      <p className="welcome-copy">
        {canManageTeam ? 'Manage workspace preferences, lead configuration, and team access.' : 'Manage workspace preferences and lead configuration.'}
      </p>
      <div className="settings-route-grid">
        {sections.filter((section) => canManageTeam || !['/settings/roles', '/settings/users', '/settings/workspace', '/subscription'].includes(section.href)).map((section) => (
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
