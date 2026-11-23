'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { crmNavigation, navigationForModules } from '../../lib/crm-navigation';

const navigationGlyphs: Record<string, string> = {
  grid: '⊞', users: '♙', contact: '◎', building: '▦', briefcase: '◇',
  vendors: '♧', billing: '$', calendar: '◷', sparkles: '✳', bell: '✉',
  chart: '⌁', search: '◉', settings: '⌁', team: '♙', subscription: '$',
};

export default function MobileNavigation({ active, enabledModules }: { active: string; enabledModules?: string[] }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const visibleItems = navigationForModules(crmNavigation, enabledModules ?? null);

  useEffect(() => {
    let active = true;
    const readSelectedWorkspace = () => {
      try {
        const stored = sessionStorage.getItem('myr.organization');
        if (!stored) return;
        const organization = JSON.parse(stored) as { id?: unknown; name?: unknown };
        if (typeof organization.id === 'string' && typeof organization.name === 'string') {
          setWorkspaceName(organization.name);
        }
      } catch { /* Keep the neutral label when saved workspace data is invalid. */ }
    };
    readSelectedWorkspace();
    window.addEventListener('myr:organization-changed', readSelectedWorkspace);
    void crmApiFetch('/auth/me')
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: unknown) => {
        if (!active || typeof payload !== 'object' || payload === null) return;
        if ('organizations' in payload && Array.isArray(payload.organizations)) {
          const organizations = payload.organizations.filter((organization): organization is { id: string; name: string } =>
            typeof organization === 'object' && organization !== null &&
            typeof (organization as { id?: unknown }).id === 'string' &&
            typeof (organization as { name?: unknown }).name === 'string',
          );
          let selectedId = '';
          try {
            const stored = sessionStorage.getItem('myr.organization');
            if (stored) selectedId = (JSON.parse(stored) as { id?: string }).id ?? '';
          } catch { /* Use the first accessible workspace below. */ }
          const selected = organizations.find((organization) => organization.id === selectedId) ?? organizations[0];
          if (selected) setWorkspaceName(selected.name);
        }
        if (!('user' in payload)) return;
        const signedInUser = payload.user;
        if (
          typeof signedInUser === 'object' &&
          signedInUser !== null &&
          'name' in signedInUser &&
          'email' in signedInUser &&
          typeof signedInUser.name === 'string' &&
          typeof signedInUser.email === 'string'
        ) {
          setUser({ name: signedInUser.name, email: signedInUser.email });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      window.removeEventListener('myr:organization-changed', readSelectedWorkspace);
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  async function signOut() {
    try { await crmApiFetch('/auth/logout', { method: 'POST' }); } catch { /* local sign-out still clears this browser session */ }
    sessionStorage.removeItem('myr.session');
    sessionStorage.removeItem('myr.user');
    sessionStorage.removeItem('myr.organization');
    window.location.assign('/sign-in');
  }

  const menuLayer = open && typeof document !== 'undefined' ? createPortal(
    <div className="mobile-nav-layer" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <nav className="mobile-nav-drawer" id="mobile-module-menu" aria-label="Main navigation">
        <div className="mobile-nav-heading">
          <img className="mobile-nav-partner-logo" src="/leadpilot-advance-solution.svg" alt="LeadPilot by Advance Solution" />
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="mobile-nav-workspace">{workspaceName} <span>·</span> WORKSPACE</p>
        <div className="mobile-nav-links">
          {visibleItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`mobile-nav-link${active === item.label ? ' active' : ''}`}
              aria-current={active === item.label ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="mobile-nav-icon" aria-hidden="true">{navigationGlyphs[item.icon]}</span>
              <span>{item.label}</span>
              {active === item.label && <i aria-hidden="true" />}
            </Link>
          ))}
        </div>
        {user ? (
          <div className="mobile-nav-account">
            <div><strong>{user.name}</strong><span>{user.email}</span></div>
            <button type="button" onClick={() => void signOut()}>Sign out</button>
          </div>
        ) : (
          <div className="mobile-nav-footer">LEADPILOT <span>·</span> Workspace preview</div>
        )}
      </nav>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`mobile-navigation${open ? ' is-open' : ''}`}>
      <button
        className="mobile-menu-trigger"
        type="button"
        aria-label={open ? 'Close main menu' : 'Open main menu'}
        aria-expanded={open}
        aria-controls="mobile-module-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span /><span /><span />
      </button>
      {menuLayer}
    </div>
  );
}
