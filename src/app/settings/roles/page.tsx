'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from '../SettingsPanels.module.css';

type PermissionProfile = 'admin' | 'sales_manager' | 'sales_rep' | 'read_only';
type Member = { userId: string; name: string; email: string; role: string; customRoleId?: string | null; customRoleName?: string | null; joinedAt: string };
type WorkspaceRole = { id: string; name: string; description: string; permissionProfile: PermissionProfile };
type RoleDefinition = { id: string; name: string; detail: string; color: string; custom?: boolean };
const builtInRoles: RoleDefinition[] = [
  { id: 'owner', name: 'Owner', detail: 'Workspace ownership, billing, security, and every administrative setting.', color: 'plum' },
  { id: 'admin', name: 'Admin', detail: 'Manage members, workspace configuration, modules, and all CRM records.', color: 'violet' },
  { id: 'sales_manager', name: 'Sales manager', detail: 'Coordinate assignments, lead distribution, sales activity, and team progress.', color: 'blue' },
  { id: 'sales_rep', name: 'Sales representative', detail: 'Work with assigned leads, contacts, deals, and follow-up activities.', color: 'green' },
  { id: 'read_only', name: 'Read only', detail: 'Review accessible workspace information without making changes.', color: 'slate' },
];
const permissionProfiles: { id: PermissionProfile; name: string; detail: string }[] = [
  { id: 'sales_manager', name: 'Sales manager access', detail: 'Team assignments and sales management tools.' },
  { id: 'sales_rep', name: 'Sales representative access', detail: 'Assigned records and follow-up work.' },
  { id: 'read_only', name: 'Read-only access', detail: 'View enabled modules without editing records.' },
  { id: 'admin', name: 'Administrator access', detail: 'Workspace administration and all enabled modules.' },
];

async function readResponse(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load workspace roles.');
  return payload;
}

export default function RolesSettingsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [customRoles, setCustomRoles] = useState<WorkspaceRole[]>([]);
  const [activeRole, setActiveRole] = useState('admin');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [newRole, setNewRole] = useState({ name: '', description: '', permissionProfile: 'sales_rep' as PermissionProfile });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membersResponse, meResponse, rolesResponse] = await Promise.all([
        crmApiFetch('/organizations/members'), crmApiFetch('/auth/me'), crmApiFetch('/organizations/roles'),
      ]);
      const [payload, me, rolePayload] = await Promise.all([readResponse(membersResponse), readResponse(meResponse), readResponse(rolesResponse)]);
      const data = Array.isArray(payload.data) ? payload.data as Member[] : [];
      const organizationId = (() => { try { return (JSON.parse(sessionStorage.getItem('myr.organization') ?? '{}') as { id?: string }).id; } catch { return undefined; } })();
      const selected = (me.organizations as { id: string; role: string }[]).find(({ id }) => id === organizationId) ?? (me.organizations as { id: string; role: string }[])[0];
      if (me.user?.id && selected?.role) data.unshift({ userId: me.user.id, name: me.user.name, email: me.user.email, role: selected.role, joinedAt: new Date().toISOString() });
      setMembers(data);
      setCustomRoles(Array.isArray(rolePayload.data) ? rolePayload.data as WorkspaceRole[] : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load workspace roles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refresh]);

  const roles = useMemo<RoleDefinition[]>(() => [
    ...builtInRoles,
    ...customRoles.map((role, index) => ({ id: role.id, name: role.name, detail: role.description || `Custom role based on ${permissionProfiles.find((profile) => profile.id === role.permissionProfile)?.name ?? role.permissionProfile.replaceAll('_', ' ')}.`, color: ['teal', 'blue', 'green', 'plum'][index % 4], custom: true })),
  ], [customRoles]);
  const activeDefinition = roles.find((role) => role.id === activeRole) ?? roles[1];
  const roleMembers = useMemo(() => members.filter((member) => (member.customRoleId ?? member.role) === activeRole && `${member.name} ${member.email}`.toLowerCase().includes(query.toLowerCase())), [activeRole, members, query]);
  const counts = roles.map((role) => ({ ...role, count: members.filter((member) => (member.customRoleId ?? member.role) === role.id).length }));

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = await readResponse(await crmApiFetch('/organizations/roles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newRole),
      }));
      const created = payload.data as WorkspaceRole;
      setNewRole({ name: '', description: '', permissionProfile: 'sales_rep' });
      setNotice(`${created.name} role added to this workspace.`);
      setActiveRole(created.id);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create this role.');
    } finally {
      setSaving(false);
    }
  }

  const displayName = (member: Member) => member.customRoleName ?? roles.find((role) => role.id === member.role)?.name ?? member.role.replaceAll('_', ' ');

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>WORKSPACE / ACCESS CONTROL</span><h2>Roles &amp; permissions</h2><p>Create workspace-specific role names and choose the access profile each role should use.</p></div><Link className={styles.primaryLink} href="/team">Manage team <span aria-hidden="true">↗</span></Link></header>
    {error && <div className={styles.error} role="alert"><div><strong>Could not update roles</strong><span>{error}</span></div><button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <section className={styles.metrics} aria-label="Role summary">
      <article><span>Active teammates</span><strong>{loading ? '—' : members.length}</strong><small>Workspace access directory</small></article>
      <article><span>Available roles</span><strong>{roles.length}</strong><small>Built-in and workspace roles</small></article>
      <article><span>Selected role</span><strong>{loading ? '—' : roleMembers.length}</strong><small>{activeDefinition?.name ?? 'Role'} teammates</small></article>
    </section>
    <section className={styles.roleBuilder}>
      <div><span className={styles.eyebrow}>ADD A WORKSPACE ROLE</span><h3>Create a role for your team</h3><p>Give it a name that fits your organization, then choose which built-in permission profile it follows.</p></div>
      <form onSubmit={(event) => void createRole(event)}>
        <label>Role name<input required minLength={2} maxLength={60} value={newRole.name} onChange={(event) => setNewRole((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Customer success" /></label>
        <label>Permission profile<select value={newRole.permissionProfile} onChange={(event) => setNewRole((current) => ({ ...current, permissionProfile: event.target.value as PermissionProfile }))}>{permissionProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label className={styles.roleDescriptionInput}>Description<input maxLength={200} value={newRole.description} onChange={(event) => setNewRole((current) => ({ ...current, description: event.target.value }))} placeholder="What this role does" /></label>
        <button className={styles.primaryLink} type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add role'}</button>
      </form>
    </section>
    <section className={styles.roleDirectory} aria-label="Select a workspace role">
      {counts.map((role) => <button type="button" key={role.id} data-tone={role.color} onClick={() => { setActiveRole(role.id); setQuery(''); }} aria-pressed={activeRole === role.id} className={`${styles.roleCard} ${activeRole === role.id ? styles.roleSelected : ''}`}>
        <span className={styles.roleCardTop}><span>{role.name}</span><b>{role.count}</b></span><span className={styles.roleDescription}>{role.detail}</span><span className={styles.roleCardAction}>{activeRole === role.id ? 'Viewing members' : 'View members'} <i aria-hidden="true">↗</i></span>
      </button>)}
    </section>
    <section className={styles.panel}>
      <div className={styles.memberToolbar}><div><span className={styles.eyebrow}>ROLE MEMBERS</span><h3>{activeDefinition?.name ?? 'Role'} access</h3></div><label className={styles.search}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a teammate" aria-label="Find a teammate" /></label></div>
      {loading ? <p className={styles.empty}>Loading workspace members…</p> : roleMembers.length ? <div className={styles.memberList}>{roleMembers.map((member) => <article className={styles.memberRow} key={member.userId}><span className={styles.avatar}>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><span className={styles.memberRole}>{displayName(member)}</span><Link href="/team">Manage</Link></article>)}</div> : <div className={styles.emptyState}><span aria-hidden="true">◎</span><strong>{query ? 'No matching teammates' : `No ${activeDefinition?.name.toLowerCase() ?? 'role'} teammates listed`}</strong><p>{query ? 'Try another name or email.' : 'Assign this role from Team & access when you add or update an employee.'}</p><Link className={styles.secondaryLink} href="/team">Open team management <span aria-hidden="true">↗</span></Link></div>}
      <footer className={styles.roleFooter}><span>Custom role names use the permission profile selected above.</span><Link href="/team">Open Team →</Link></footer>
    </section>
  </main>;
}
