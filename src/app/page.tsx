'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import NotificationPopover from './components/NotificationPopover';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import ProfileMenu from './components/ProfileMenu';
import GlobalSearch from './components/GlobalSearch';
import HelpPopover from './components/HelpPopover';
import DashboardLivePanels from './components/DashboardLivePanels';
import ClearSampleDataButton from './components/ClearSampleDataButton';
import MobileNavigation from './components/MobileNavigation';
import { SubscriptionExpiryBanner } from './components/WorkspaceAccessGate';
import { crmApiFetch } from '../lib/api-client';
import { crmNavigation, navigationForModules } from '../lib/crm-navigation';
import { useWorkspaceModuleAccess } from './components/WorkspaceModuleAccess';
import { readWorkspacePreference, writeWorkspacePreference } from '../lib/workspace-preferences';

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    users: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm2 5a4 4 0 0 1 3 4v2m-1-15a4 4 0 0 1 0 8",
    contact: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    building: "M3 21h18M5 21V5l7-3 7 3v16M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01",
    briefcase: "M3 7h18v13H3zM8 7V4h8v3m-13 5h18m-11 0v2h4v-2",
    calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    sparkles: "m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z",
    chart: "M3 3v18h18M8 15l4-4 4 3 5-7",
    coins: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Zm-8-3v5c0 1.7 3.6 3 8 3 1.5 0 2.9-.2 4.1-.5M4 10v5c0 1.7 3.6 3 8 3 .7 0 1.4 0 2-.1m-10-2v5c0 1.7 3.6 3 8 3m6-8c2.2 0 4-1.1 4-2.5S20.2 11 18 11s-4 1.1-4 2.5 1.8 2.5 4 2.5Zm-4-2.5V19c0 1.4 1.8 2.5 4 2.5s4-1.1 4-2.5v-5.5",
    trophy: "M8 21h8m-4-4v4m-6-18h12v5a6 6 0 0 1-12 0V3Zm0 2H3v2a5 5 0 0 0 5 5m8-7h5v2a5 5 0 0 1-5 5",
    search: "m21 21-4.3-4.3M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
    plus: "M12 5v14m-7-7h14",
    arrow: "M7 17 17 7M7 7h10v10",
    chevron: "m9 18 6-6-6-6",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

export default function Home() {
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
          <Link className="brand" href="/" aria-label="Myr CRM home">
            <span className="brand-mark">m</span>
            <span>myr<span className="brand-light">crm</span></span>
          </Link>
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span></button>
        </div>

        <WorkspaceSwitcher />

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigationForModules(crmNavigation, enabledModules).map((item) => (
            <a
              className={`nav-item${item.label === 'Overview' ? " active" : ""}`}
              href={item.href}
              key={item.label}
            >
              <Icon name={item.icon === 'vendors' ? 'building' : item.icon === 'billing' || item.icon === 'subscription' || item.icon === 'settings' ? 'coins' : item.icon === 'team' ? 'users' : item.icon} />
              <span>{item.label}</span>
              {"count" in item && typeof item.count === "number" && item.count > 0 && <span className="nav-count">{item.count}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✳</div>
            <strong>Need a hand?</strong>
            <p>Visit our help center to get started.</p>
            <HelpPopover />
          </div>
          
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <MobileNavigation active="Overview" enabledModules={enabledModules ?? undefined} />
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron" />
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <SubscriptionExpiryBanner />
            <GlobalSearch />
            <NotificationPopover />
            <ProfileMenu />
            <div className="preview-chip"><span /> Live workspace data</div>
            <button className="header-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
          </div>
        </header>
        {signOutError && <p className="module-permissions-error" role="alert">{signOutError}</p>}

        <div className="content">
          <section className="welcome-row">
            <div>
              <p className="date-label">WORKSPACE OVERVIEW</p>
              <h1>Your CRM at a glance</h1>
              <p className="welcome-copy">Here&apos;s what&apos;s happening with your workspace today.</p>
            </div>
            <div className="welcome-actions">
              <a className="button button-secondary" href="/reports">View reports <span className="button-caret">↗</span></a>
              <ClearSampleDataButton />
              <a className="button button-primary" href="/leads">
                <Icon name="plus" /> Add new lead
              </a>
            </div>
          </section>

          <DashboardLivePanels />

          <footer className="page-footer">
            <span>MYR CRM <i /> Workspace overview</span>
            <span>Live workspace data</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
