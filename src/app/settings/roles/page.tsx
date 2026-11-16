'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from '../SettingsPanels.module.css';

type Member = { userId: string; name: string; email: string; role: string; joinedAt: string };
const roleOptions = [
  { id: 'owner', name: 'Owner', detail: 'Workspace ownership, billing, security, and every administrative setting.', color: 'plum' },
  { id: 'admin', name: 'Admin', detail: 'Manage members, workspace configuration, modules, and all CRM records.', color: 'violet' },
  { id: 'sales_manager', name: 'Sales manager', detail: 'Coordinate assignments, lead distribution, sales activity, and team progress.', color: 'blue' },
  { id: 'sales_rep', name: 'Sales representative', detail: 'Work with assigned leads, contacts, deals, and follow-up activities.', color: 'green' },
  { id: 'read_only', name: 'Read only', detail: 'Review accessible workspace information without making changes.', color: 'slate' },
];
const displayName = (value: string) => roleOptions.find((role) => role.id === value)?.name ?? value.replaceAll('_', ' ');

export default function RolesSettingsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [activeRole, setActiveRole] = useState('admin');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [response, meResponse] = await Promise.all([crmApiFetch('/organizations/members'), crmApiFetch('/auth/me')]);
      const [payload, me] = await Promise.all([response.json(), meResponse.json()]);
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load workspace members.');
      if (!meResponse.ok || !Array.isArray(me.organizations)) throw new Error(me?.error?.message ?? 'Could not load the current workspace role.');
      const data = Array.isArray(payload.data) ? payload.data as Member[] : [];
      const selectedId = (() => { try { return (JSON.parse(sessionStorage.getItem('myr.organization') ?? '{}') as { id?: string }).id; } catch { return undefined; } })();
      const selected = (me.organizations as { id: string; role: string }[]).find(({ id }) => id === selectedId) ?? (me.organizations as { id: string; role: string }[])[0];
      if (me.user?.id && selected?.role) data.unshift({ userId: me.user.id, name: me.user.name, email: me.user.email, role: selected.role, joinedAt: new Date().toISOString() });
      setMembers(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load workspace members.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refresh]);

  const activeDefinition = roleOptions.find((role) => role.id === activeRole) ?? roleOptions[1];
  const roleMembers = useMemo(() => members.filter((member) => member.role === activeRole && `${member.name} ${member.email}`.toLowerCase().includes(query.toLowerCase())), [activeRole, members, query]);
  const counts = roleOptions.map((role) => ({ ...role, count: members.filter((member) => member.role === role.id).length }));

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>WORKSPACE / ACCESS CONTROL</span><h2>Roles &amp; permissions</h2><p>Review workspace roles and see who currently has each level of access.</p></div><Link className={styles.primaryLink} href="/team">Manage team <span aria-hidden="true">↗</span></Link></header>
    {error && <div className={styles.error} role="alert"><div><strong>Role directory couldn’t load</strong><span>{error}</span></div><button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
    <section className={styles.metrics} aria-label="Role summary">
      <article><span>Active teammates</span><strong>{loading ? '—' : members.length}</strong><small>Workspace access directory</small></article>
      <article><span>Available roles</span><strong>{roleOptions.length}</strong><small>Built-in permission levels</small></article>
      <article><span>Selected role</span><strong>{loading ? '—' : roleMembers.length}</strong><small>{activeDefinition.name} teammates</small></article>
    </section>
    <section className={styles.roleDirectory} aria-label="Select a workspace role">
      {counts.map((role) => <button type="button" key={role.id} data-tone={role.color} onClick={() => { setActiveRole(role.id); setQuery(''); }} aria-pressed={activeRole === role.id} className={`${styles.roleCard} ${activeRole === role.id ? styles.roleSelected : ''}`}>
        <span className={styles.roleCardTop}><span>{role.name}</span><b>{role.count}</b></span><span className={styles.roleDescription}>{role.detail}</span><span className={styles.roleCardAction}>{activeRole === role.id ? 'Viewing members' : 'View members'} <i aria-hidden="true">↗</i></span>
      </button>)}
    </section>
    <section className={styles.panel}>
      <div className={styles.memberToolbar}><div><span className={styles.eyebrow}>ROLE MEMBERS</span><h3>{activeDefinition.name} access</h3></div><label className={styles.search}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" /></label></div>
      {loading ? <p className={styles.empty}>Loading workspace members…</p> : roleMembers.length ? <div className={styles.memberList}>{roleMembers.map((member) => <article className={styles.memberRow} key={member.userId}><span className={styles.avatar}>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><span className={styles.memberRole}>{displayName(member.role)}</span><Link href="/team">Manage</Link></article>)}</div> : <div className={styles.emptyState}><span aria-hidden="true">◎</span><strong>{query ? 'No matching teammates' : `No ${activeDefinition.name.toLowerCase()} teammates listed`}</strong><p>{query ? 'Try another name or email.' : 'Workspace owners are not included in the employee directory.'}</p><Link className={styles.secondaryLink} href="/team">Open team management <span aria-hidden="true">↗</span></Link></div>}
      <footer className={styles.roleFooter}><span>Role permissions are built in. Assign a different role from Team.</span><Link href="/team">Open Team →</Link></footer>
    </section>
  </main>;
}
