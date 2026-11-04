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

const navigation = [
  ['Overview', '/', '◫'], ['Leads', '/leads', '♙'], ['Contacts', '/contacts', '◎'],
  ['Companies', '/companies', '▦'], ['Deals', '/deals', '◇'], ['Activities', '/activities', '◷'],
  ['Team', '/team', '♙'], ['Automation', '/automation', '✳'], ['Reports', '/reports', '⌁'],
];

export default function CrmShell({ active, children }: { active: string; children: ReactNode }) {
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [moduleAccessError, setModuleAccessError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetchEnabledModules(controller.signal)
      .then(setEnabledModules)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setModuleAccessError(error instanceof Error ? error.message : 'Could not load workspace module access.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Myr CRM home"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
        <WorkspaceSwitcher />
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.filter(([label, href]) => label === 'Overview' || enabledModules.includes(href.slice(1))).map(([label, href, icon]) => (
            <Link key={label} href={href} className={`nav-item${label === active ? ' active' : ''}`} aria-label={label} aria-current={label === active ? 'page' : undefined}>
              <span className="module-nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>
              {label === 'Leads' && <span className="nav-count">24</span>}{label === 'Activities' && <span className="nav-count">5</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Need a hand?</strong><p>Visit our help center to get started.</p><HelpPopover /></div><ProfileMenu /></div>
      </aside>
      <section className="main-panel">
        <header className="topbar">
          <MobileNavigation active={active} enabledModules={enabledModules} />
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">›</span><strong>{active}</strong></div>
          <div className="topbar-actions"><SubscriptionExpiryBanner /><GlobalSearch /><NotificationPopover /><span className="preview-chip"><span />{['Leads', 'Contacts', 'Companies', 'Deals', 'Team'].includes(active) ? 'Live workspace' : 'Preview data'}</span></div>
        </header>
        {moduleAccessError && <p className="module-permissions-error" role="alert">{moduleAccessError}</p>}
        {children}
      </section>
    </main>
  );
}