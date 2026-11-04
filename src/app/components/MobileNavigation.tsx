'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const items = [
  { label: 'Overview', href: '/' },
  { label: 'Leads', href: '/leads' },
  { label: 'Contacts', href: '/contacts' },
  { label: 'Companies', href: '/companies' },
  { label: 'Deals', href: '/deals' },
  { label: 'Activities', href: '/activities' },
  { label: 'Automation', href: '/automation' },
  { label: 'Email', href: '/email' },
  { label: 'Reports', href: '/reports' },
  { label: 'Audit Logs', href: '/audit-logs' },
  { label: 'Settings', href: '/settings' },
  { label: 'Team', href: '/team' },
];

export default function MobileNavigation({ active }: { active: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  const getIcon = (label: string) => {
    if (label === 'Overview') return '◫';
    if (label === 'Leads' || label === 'Team') return '♙';
    if (label === 'Contacts') return '◎';
    if (label === 'Companies') return '▦';
    if (label === 'Deals') return '◇';
    if (label === 'Activities') return '◷';
    if (label === 'Automation') return '✳';
    if (label === 'Email') return '✉';
    if (label === 'Reports') return '⌁';
    if (label === 'Audit Logs') return '◉';
    if (label === 'Settings') return '⚙';
    return '⌁';
  };

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
      {open && (
        <div className="mobile-nav-layer" onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <nav className="mobile-nav-drawer" id="mobile-module-menu" aria-label="Main navigation">
            <div className="mobile-nav-heading">
              <span className="brand-mark">m</span>
              <span className="mobile-nav-brand">myr<span>crm</span></span>
              <button type="button" aria-label="Close menu" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <p className="mobile-nav-workspace">
              STUDIO NORTH <span>·</span> WORKSPACE
            </p>
            <div className="mobile-nav-links">
              {items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`mobile-nav-link${active === item.label ? ' active' : ''}`}
                  aria-current={active === item.label ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span className="mobile-nav-icon" aria-hidden="true">
                    {getIcon(item.label)}
                  </span>
                  <span>{item.label}</span>
                  {active === item.label && <i aria-hidden="true" />}
                </Link>
              ))}
            </div>
            <div className="mobile-nav-footer">
              MYR CRM <span>·</span> Workspace preview
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
