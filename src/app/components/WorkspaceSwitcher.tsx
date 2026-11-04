'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Organization = { id: string; name: string };

function parseOrganization(value: string | null): Organization | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Organization>;
    return typeof parsed.id === 'string' && typeof parsed.name === 'string' ? { id: parsed.id, name: parsed.name } : null;
  } catch { return null; }
}

export default function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [active, setActive] = useState<Organization>({ id: '', name: 'Studio North' });
  const [signedIn, setSignedIn] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const saved = parseOrganization(sessionStorage.getItem('myr.organization'));
    if (saved) setActive(saved);
    crmApiFetch('/auth/me')
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!payload?.organizations) return;
        setSignedIn(true);
        const orgs = payload.organizations as Organization[];
        setOrganizations(orgs);
        if (orgs.length && !orgs.some((org) => org.id === (saved?.id ?? ''))) {
          setActive(orgs[0]);
          sessionStorage.setItem('myr.organization', JSON.stringify(orgs[0]));
        }
      }).catch(() => setSignedIn(false));
  }, []);

  if (!hydrated) {
    // Render nothing on the server so the client hydration HTML matches exactly.
    // The workspace switcher is populated client-side after session data loads.
    return null;
  }

  return (
    <div className="workspace-control"><button className="workspace-switcher" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className="workspace-avatar">{active.name.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{active.name}</strong><small>{signedIn ? 'Your workspace' : 'Preview workspace'}</small></span><span className="switcher-chevron">⌄</span></button>{open && <div className="workspace-menu" role="menu"><span className="workspace-menu-title">YOUR WORKSPACES</span>{organizations.length ? organizations.map((organization) => <button type="button" role="menuitem" key={organization.id} className={organization.id === active.id ? 'selected' : ''} onClick={() => { setActive(organization); sessionStorage.setItem('myr.organization', JSON.stringify(organization)); setOpen(false); }}><span>{organization.name.slice(0, 1).toUpperCase()}</span>{organization.name}{organization.id === active.id && <b>✓</b>}</button>) : <p>{signedIn ? 'No workspaces are available for this account.' : 'Sign in to see your workspaces.'}</p>}{!signedIn && <a href="/sign-in">Sign in to your account →</a>}</div>}</div>
  );
}
