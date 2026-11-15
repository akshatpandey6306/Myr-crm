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
import { fetchEnabledModules } from '../../lib/module-permissions';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

const navigation = [
  ['Overview', '/', '◫'], ['Leads', '/leads', '♙'], ['Contacts', '/contacts', '◎'],
  ['Companies', '/companies', '▦'], ['Deals', '/deals', '◇'], ['Vendors', '/vendors', '♧'], ['Billing & Invoicing', '/billing-invoicing', '$'], ['Activities', '/activities', '◷'],
  ['Team', '/team', '♙'], ['Automation', '/automation', '✳'], ['Email', '/email', '✉'],
  ['Reports', '/reports', '⌁'], ['Audit Logs', '/audit-logs', '◉'], ['Settings', '/settings', '⚙'],
];

export default function CrmShell({ active, children }: { active: string; children: ReactNode }) {
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [moduleAccessError, setModuleAccessError] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  useEffect(() => {
    const savedPreference = window.localStorage.getItem('myr.sidebar.collapsed');
    const collapsed = savedPreference === null
      ? window.matchMedia('(min-width: 601px) and (max-width: 850px)').matches
      : savedPreference === 'true';
    setSidebarCollapsed(collapsed);
  }, []);

  useEffect(() => {
    let controller = new AbortController();
    const loadModules = () => {
      controller.abort();
      const requestController = new AbortController();
      controller = requestController;
      setEnabledModules([]);
      setModuleAccessError('');
      void fetchEnabledModules(requestController.signal)
        .then(setEnabledModules)
        .catch((error: unknown) => {
          if (!requestController.signal.aborted) {
            setModuleAccessError(error instanceof Error ? error.message : 'Could not load workspace module access.');
          }
        });
    };
    loadModules();
    window.addEventListener('myr:organization-changed', loadModules);
    return () => {
      controller.abort();
      window.removeEventListener('myr:organization-changed', loadModules);
    };
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem('myr.sidebar.collapsed', String(next));
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
          <Link className="brand" href="/" aria-label="Myr CRM home"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span></button>
        </div>
        <WorkspaceSwitcher />
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.filter(([label, href]) => label === 'Overview' || enabledModules.includes(href.slice(1))).map(([label, href, icon]) => (
            <Link key={label} href={href} className={`nav-item${label === active ? ' active' : ''}`} aria-label={label} aria-current={label === active ? 'page' : undefined}>
              <span className="module-nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Need a hand?</strong><p>Visit our help center to get started.</p><HelpPopover /></div><ProfileMenu /></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <MobileNavigation active={active} enabledModules={enabledModules} />
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">›</span><strong>{active}</strong></div>
          <div className="topbar-actions">
            <SubscriptionExpiryBanner />
            <GlobalSearch />
            <NotificationPopover />
            <span className="preview-chip"><span />{['Leads', 'Contacts', 'Companies', 'Deals', 'Team'].includes(active) ? 'Live workspace' : 'Preview data'}</span>
            <button className="header-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
            {signOutError && <span className="header-signout-error" role="alert">{signOutError}</span>}
          </div>
        </header>
        {moduleAccessError && <p className="module-permissions-error" role="alert">{moduleAccessError}</p>}
        {children}
      </section>
    </main>
  );
}