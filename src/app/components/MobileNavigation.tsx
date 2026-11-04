'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const items = [
  { label: 'Overview', href: '/', icon: '◫' },
  { label: 'Leads', href: '/leads', icon: '♙' },
  { label: 'Contacts', href: '/contacts', icon: '◎' },
  { label: 'Companies', href: '/companies', icon: '▦' },
  { label: 'Deals', href: '/deals', icon: '◇' },
  { label: 'Activities', href: '/activities', icon: '◷' },
  { label: 'Team', href: '/team', icon: '♙' },
  { label: 'Automation', href: '/automation', icon: '✳' },
  { label: 'Reports', href: '/reports', icon: '⌁' },
];

export default function MobileNavigation({ active, enabledModules }: { active: string; enabledModules: string[] }) {
  const [open, setOpen] = useState(false);
  const visibleItems = items.filter((item) => item.label === 'Overview' || enabledModules.includes(item.href.slice(1)));

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  return <div className={`mobile-navigation${open ? ' is-open' : ''}`}><button className="mobile-menu-trigger" type="button" aria-label={open ? 'Close main menu' : 'Open main menu'} aria-expanded={open} aria-controls="mobile-module-menu" onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>{open && <div className="mobile-nav-layer"><nav className="mobile-nav-drawer" id="mobile-module-menu" aria-label="Main navigation"><div className="mobile-nav-heading"><span className="brand-mark">m</span><span className="mobile-nav-brand">myr<span>crm</span></span><button type="button" aria-label="Close menu" onClick={() => setOpen(false)}>×</button></div><p className="mobile-nav-workspace">STUDIO NORTH <span>·</span> WORKSPACE</p><div className="mobile-nav-links">{visibleItems.map((item) => <Link key={item.label} href={item.href} className={`mobile-nav-link${active === item.label ? ' active' : ''}`} aria-current={active === item.label ? 'page' : undefined} onClick={() => setOpen(false)}><span className="mobile-nav-icon">{item.icon}</span><span>{item.label}</span>{active === item.label && <i />}</Link>)}</div><div className="mobile-nav-footer">MYR CRM <span>·</span> Workspace preview</div></nav></div>}</div>;
}
