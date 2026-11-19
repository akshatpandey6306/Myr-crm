'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import ProfileMenu from './ProfileMenu';
import HelpPopover from './HelpPopover';
import MobileNavigation from './MobileNavigation';
import GlobalSearch from './GlobalSearch';
import NotificationPopover from './NotificationPopover';
import { SubscriptionExpiryBanner } from './WorkspaceAccessGate';
import { useWorkspaceModuleAccess } from './WorkspaceModuleAccess';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { readWorkspacePreference, writeWorkspacePreference } from '../../lib/workspace-preferences';
import { crmNavigation, navigationForModules } from '../../lib/crm-navigation';

const navigationGlyphs: Record<string, string> = {
  grid: '⊞', users: '♙', contact: '◎', building: '▦', briefcase: '◇',
  vendors: '♧', billing: '$', calendar: '◷', sparkles: '✳', bell: '✉',
  chart: '⌁', search: '◉', settings: '⌁', team: '♙', subscription: '$',
};

export default function CrmShell({ active, children }: { active: string; children: ReactNode }) {
  const enabledModules = useWorkspaceModuleAccess();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    const loadSidebarPreference = () => {
      const savedPreference = readWorkspacePreference('sidebar.collapsed');
      setSidebarCollapsed(savedPreference === null
        ? window.matchMedia('(min-width: 601px) and (max-width: 850px)').matches
        : savedPreference === 'true');
    };
    loadSidebarPreference();
    window.addEventListener('myr:organization-changed', loadSidebarPreference);
    return () => window.removeEventListener('myr:organization-changed', loadSidebarPreference);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      writeWorkspacePreference('sidebar.collapsed', String(next));
      return next;
    });
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const response = await crmApiFetch('/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(`Sign out failed (HTTP ${response.status}). Please try again.`);
      sessionStorage.removeItem('myr.session');
      sessionStorage.removeItem('myr.user');
      sessionStorage.removeItem('myr.organization');
      window.location.assign('/sign-in');
    } catch (caught) {
      setSignOutError(caught instanceof Error ? caught.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <Link className="brand" href="/" aria-label="LeadPilot by Advance Solution home"><img className="brand-partner-logo" src="/leadpilot-advance-solution.svg" alt="LeadPilot by Advance Solution" /><img className="brand-symbol-logo" src="/advance-solution-logo.svg" alt="" /></Link>
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span></button>
        </div>
        <WorkspaceSwitcher />
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigationForModules(crmNavigation, enabledModules).map(({ label, href, icon }) => (
            <Link key={label} href={href} className={`nav-item${label === active ? ' active' : ''}`} aria-label={label} aria-current={label === active ? 'page' : undefined}>
              <span className="module-nav-icon" aria-hidden="true">{navigationGlyphs[icon]}</span><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Need a hand?</strong><p>Visit our help center to get started.</p><HelpPopover /></div></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <MobileNavigation active={active} enabledModules={enabledModules ?? undefined} />
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">›</span><strong>{active}</strong></div>
          <div className="topbar-actions">
            <SubscriptionExpiryBanner />
            <GlobalSearch />
            <NotificationPopover />
            <ProfileMenu />
            <span className="preview-chip"><span />{['Leads', 'Contacts', 'Companies', 'Deals', 'Team', 'Subscription'].includes(active) ? 'Live workspace' : 'Preview data'}</span>
            <button className="header-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
            {signOutError && <span className="header-signout-error" role="alert">{signOutError}</span>}
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
