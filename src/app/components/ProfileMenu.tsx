'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type User = { name: string; email: string };

function parseUser(value: string | null): User | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<User>;
    return typeof parsed.name === 'string' && typeof parsed.email === 'string' ? { name: parsed.name, email: parsed.email } : null;
  } catch { return null; }
}

export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User>({ name: 'Maya Chen', email: 'maya@studionorth.co' });
  const [signedIn, setSignedIn] = useState(false);
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('myr.session');
    const storedUser = parseUser(sessionStorage.getItem('myr.user'));
    if (!token && !storedUser) return;
    setSignedIn(true);
    if (storedUser) setUser(storedUser);
    crmApiFetch('/control-panel/access')
      .then((response) => setPlatformAdmin(response.ok))
      .catch(() => undefined);
    crmApiFetch('/auth/me')
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload?.user) { setUser(payload.user); sessionStorage.setItem('myr.user', JSON.stringify(payload.user)); } })
      .catch(() => undefined);
  }, []);

  async function signOut() {
    const token = sessionStorage.getItem('myr.session');
    if (token || sessionStorage.getItem('myr.user')) {
      try { await crmApiFetch('/auth/logout', { method: 'POST' }); } catch { /* local sign-out still clears this browser session */ }
    }
    sessionStorage.removeItem('myr.session');
    sessionStorage.removeItem('myr.user');
    sessionStorage.removeItem('myr.organization');
    window.location.assign('/sign-in');
  }

  return <div className="profile-control"><button className="profile-button" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}><span className="avatar avatar-maya">{user.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span><span className="profile-more" aria-hidden="true">···</span></button>{open && <div className="profile-menu" role="menu"><div className="profile-menu-user"><strong>{user.name}</strong><span>{user.email}</span></div>{signedIn && platformAdmin && <a href="/control-panel" role="menuitem">Control panel <span>→</span></a>}{signedIn ? <button type="button" role="menuitem" onClick={signOut}>Sign out <span>↗</span></button> : <><a href="/sign-in">Sign in <span>→</span></a><a href="/sign-up">Create an account <span>→</span></a></>}</div>}</div>;
}
