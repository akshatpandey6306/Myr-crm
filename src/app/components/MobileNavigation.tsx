'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

const items = [
  { label: 'Overview', href: '/', icon: '◫' },
  { label: 'Leads', href: '/leads', icon: '♙' },
  { label: 'Contacts', href: '/contacts', icon: '◎' },
  { label: 'Companies', href: '/companies', icon: '▦' },
  { label: 'Deals', href: '/deals', icon: '◇' },
  { label: 'Activities', href: '/activities', icon: '◷' },
  { label: 'Automation', href: '/automation', icon: '✳' },
  { label: 'Email', href: '/email', icon: '✉' },
  { label: 'Reports', href: '/reports', icon: '⌁' },
  { label: 'Audit Logs', href: '/audit-logs', icon: '◉' },
  { label: 'Settings', href: '/settings', icon: '⚙' },
  { label: 'Team', href: '/team', icon: '♙' },
];

export default function MobileNavigation({ active, enabledModules }: { active: string; enabledModules?: string[] }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const visibleItems = enabledModules
    ? items.filter((item) => item.label === 'Overview' || enabledModules.includes(item.href.slice(1)))
    : items;

  useEffect(() => {
    let active = true;
    void crmApiFetch('/auth/me')
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: unknown) => {
        if (!active || typeof payload !== 'object' || payload === null || !('user' in payload)) return;
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
    return () => { active = false; };
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
          <span className="brand-mark">m</span>
          <span className="mobile-nav-brand">myr<span>crm</span></span>
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="mobile-nav-workspace">STUDIO NORTH <span>·</span> WORKSPACE</p>
        <div className="mobile-nav-links">
          {visibleItems.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`mobile-nav-link${active === item.label ? ' active' : ''}`}
              aria-current={active === item.label ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="mobile-nav-icon" aria-hidden="true">{item.icon}</span>
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
          <div className="mobile-nav-footer">MYR CRM <span>·</span> Workspace preview</div>
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
