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
  { label: 'Security & devices', href: '/settings/security' },
  { label: 'Workspace control', href: '/settings/workspace' },
  { label: 'Subscription', href: '/subscription' },
];

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleRefresh, setRoleRefresh] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let controller = new AbortController();
    const loadRole = () => {
      controller.abort();
      controller = new AbortController();
      setCanManageTeam(false);
      setRoleError('');
      setRoleLoading(true);
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
        })
        .finally(() => { if (!controller.signal.aborted) setRoleLoading(false); });
    };
    loadRole();
    window.addEventListener('myr:organization-changed', loadRole);
    return () => {
      controller.abort();
      window.removeEventListener('myr:organization-changed', loadRole);
    };
  }, [roleRefresh]);

  const teamSettingsPath = pathname === '/settings/users' || pathname === '/settings/roles' || pathname === '/settings/workspace';
  useEffect(() => {
    if (!roleLoading && !roleError && !canManageTeam && teamSettingsPath) router.replace('/settings');
  }, [canManageTeam, roleError, roleLoading, router, teamSettingsPath]);

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
              {settingsSections.filter((section) => (section.href !== '/subscription' || canManageTeam) && (canManageTeam || !['/settings/users', '/settings/roles', '/settings/workspace'].includes(section.href))).map((section) => (
                <Link key={section.href} href={section.href}>{section.label}</Link>
              ))}
            </nav>
          </header>
          {teamSettingsPath && roleError && <div className="settings-access-state settings-access-error" role="alert"><span>{roleError}</span><button type="button" onClick={() => setRoleRefresh((value) => value + 1)}>Retry</button></div>}
          {teamSettingsPath && roleLoading ? <p className="settings-access-state" role="status">Checking workspace access...</p> : teamSettingsPath && (roleError || !canManageTeam) ? null : children}
        </div>
      </SettingsTeamAccessContext.Provider>
    </CrmShell>
  );
}
