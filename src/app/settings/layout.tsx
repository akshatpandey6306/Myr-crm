'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useEffect, useState } from 'react';
import CrmShell from '../components/CrmShell';
import { crmApiFetch } from '../../lib/api-client';
import './settings.css';

export const SettingsTeamAccessContext = createContext({ canManageTeam: false, roleError: '' });

const settingsSections = [
  { label: 'Overview', href: '/settings' },
  { label: 'General', href: '/settings/general' },
  { label: 'Leads', href: '/settings/leads' },
  { label: 'Roles', href: '/settings/roles' },
  { label: 'Users', href: '/settings/users' },
];

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [roleError, setRoleError] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let controller = new AbortController();
    const loadRole = () => {
      controller.abort();
      controller = new AbortController();
      setCanManageTeam(false);
      setRoleError('');
      void crmApiFetch('/auth/me', { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok || !Array.isArray(payload.organizations)) throw new Error('Could not verify workspace role.');
        let organizationId = '';
        try {
          const saved = sessionStorage.getItem('myr.organization');
          const parsed = saved ? JSON.parse(saved) as { id?: unknown } : null;
          if (typeof parsed?.id === 'string') organizationId = parsed.id;
          } catch { /* Invalid cached workspace data grants no team access. */ }
        const organizations = payload.organizations as { id?: unknown; role?: unknown }[];
          const selected = organizationId
            ? organizations.find(({ id }) => id === organizationId)
            : organizations[0];
        if (!controller.signal.aborted) {
          setCanManageTeam(selected?.role === 'owner' || selected?.role === 'admin');
        }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setCanManageTeam(false);
            setRoleError(error instanceof Error ? error.message : 'Could not verify workspace role.');
          }
        });
    };
    loadRole();
    window.addEventListener('myr:organization-changed', loadRole);
    return () => {
      controller.abort();
      window.removeEventListener('myr:organization-changed', loadRole);
    };
  }, []);

  const teamSettingsPath = pathname === '/settings/users' || pathname === '/settings/roles';
  useEffect(() => {
    if (!canManageTeam && teamSettingsPath) router.replace('/settings');
  }, [canManageTeam, router, teamSettingsPath]);

  return (
    <CrmShell active="Settings">
      <SettingsTeamAccessContext.Provider value={{ canManageTeam, roleError }}>
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
              {settingsSections.filter((section) => canManageTeam || !['/settings/users', '/settings/roles'].includes(section.href)).map((section) => (
                <Link key={section.href} href={section.href}>{section.label}</Link>
              ))}
            </nav>
          </header>
          {roleError && <p className="settings-route-content" role="alert">{roleError}</p>}
          {teamSettingsPath && !canManageTeam ? <p className="settings-route-content">Checking administrator access…</p> : children}
        </div>
      </SettingsTeamAccessContext.Provider>
    </CrmShell>
  );
}
