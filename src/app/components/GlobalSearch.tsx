'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

const destinations = [
  { label: 'Overview', href: '/' }, { label: 'Leads', href: '/leads' },
  { label: 'Contacts', href: '/contacts' }, { label: 'Companies', href: '/companies' },
  { label: 'Deals', href: '/deals' }, { label: 'Vendors', href: '/vendors' },
  { label: 'Billing & Invoicing', href: '/billing-invoicing' },
  { label: 'Activities', href: '/activities' },
  { label: 'Automation', href: '/automation' }, { label: 'Reports', href: '/reports' },
  { label: 'Sign in', href: '/sign-in' },
];

const SearchIcon = () => <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><path d="m21 21-4.3-4.3M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z" /></svg>;

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => query.trim() ? destinations.filter((destination) => destination.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5) : [], [query]);

  useEffect(() => {
    if (mobileOpen) { setOpen(true); input.current?.focus(); }
  }, [mobileOpen]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMobileOpen(true); setOpen(true); input.current?.focus(); }
      if (event.key === 'Escape') { setOpen(false); setQuery(''); setMobileOpen(false); }
    }
    function outside(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) { setOpen(false); setMobileOpen(false); }
    }
    document.addEventListener('keydown', shortcut);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', shortcut); document.removeEventListener('pointerdown', outside); };
  }, []);

  function close() { setOpen(false); setQuery(''); setMobileOpen(false); }

  return <div className={`global-search-root${mobileOpen ? ' mobile-search-open' : ''}`} ref={root}>
    <button className="global-search-mobile-trigger" type="button" aria-label={mobileOpen ? 'Close search' : 'Search workspace'} aria-expanded={mobileOpen} onClick={() => mobileOpen ? close() : setMobileOpen(true)}><SearchIcon /></button>
    <label className="search-box"><SearchIcon /><input ref={input} aria-label="Search workspace modules" placeholder="Search modules..." value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} /><kbd>⌘ K</kbd></label>
    {open && query && <div className="global-search-results" role="listbox" aria-label="Search results">{matches.length ? matches.map((match) => <Link key={match.href} href={match.href} role="option" onClick={close}><span>{match.label}</span><span>→</span></Link>) : <p>No matching workspace pages.</p>}<small>Search pages and modules</small></div>}
  </div>;
}
