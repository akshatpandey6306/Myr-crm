'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from './MembersManager.module.css';

type Role = 'owner' | 'admin' | 'sales_manager' | 'sales_rep' | 'read_only';
type Member = { userId: string; name: string; email: string; role: Role; emailVerified: boolean; joinedAt: string };
type Invitation = { id: string; email: string; role: Exclude<Role, 'owner'>; expiresAt: string };

const roleOptions: { value: Exclude<Role, 'owner'>; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'sales_rep', label: 'Sales Representative' },
  { value: 'read_only', label: 'Read-only User' },
];

async function responseMessage(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? 'The request could not be completed.');
  return payload;
}

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('sales_rep');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membersResponse, invitationsResponse, meResponse] = await Promise.all([
        crmApiFetch('/organizations/members'),
        crmApiFetch('/organizations/invitations'),
        crmApiFetch('/auth/me'),
      ]);
      const [membersPayload, invitationsPayload, mePayload] = await Promise.all([
        responseMessage(membersResponse),
        responseMessage(invitationsResponse),
        responseMessage(meResponse),
      ]);
      setMembers(membersPayload.data as Member[]);
      setInvitations(invitationsPayload.data as Invitation[]);
      const saved = sessionStorage.getItem('myr.organization');
      let organizationId = '';
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { id?: unknown };
          if (typeof parsed.id === 'string') organizationId = parsed.id;
        } catch { /* Invalid cached organization data is ignored. */ }
      }
      const activeOrganization = (mePayload.organizations as { id: string; role: Role }[]).find((organization) => organization.id === organizationId)
        ?? (mePayload.organizations as { id: string; role: Role }[])[0];
      setCurrentRole(activeOrganization?.role ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load organization members.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await responseMessage(await crmApiFetch('/organizations/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      }));
      setEmail('');
      setNotice(`Invitation sent to ${email}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send this invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(member: Member, newRole: Exclude<Role, 'owner'>) {
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      }));
      setNotice(`${member.name} is now a ${roleOptions.find((item) => item.value === newRole)?.label}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this role.');
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}`, { method: 'DELETE' }));
      setNotice(`${member.name} was removed from the workspace.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this member.');
    }
  }

  async function transferOwnership(member: Member) {
    if (!window.confirm(`Transfer workspace ownership to ${member.name}? You will become an Admin.`)) return;
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}/transfer-ownership`, { method: 'PATCH' }));
      setNotice(`Ownership transferred to ${member.name}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not transfer ownership.');
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/invitations/${invitation.id}`, { method: 'DELETE' }));
      setNotice(`Invitation to ${invitation.email} was revoked.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke this invitation.');
    }
  }

  const canManage = currentRole === 'owner' || currentRole === 'admin';
  return (
    <section className={styles.manager}>
      <header className={styles.heading}>
        <div><p className="date-label">WORKSPACE / TEAM</p><h1>Team & access</h1><p className="welcome-copy">Invite people and manage their organization roles.</p></div>
      </header>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {!loading && !canManage && !error && <div className={styles.error} role="alert">Only the Organization Owner or Admin can manage members and invitations.</div>}

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h2>Members</h2><p>{members.length} active in this workspace</p></div></div>
        {loading ? <p className={styles.empty}>Loading members…</p> : members.length === 0 ? <p className={styles.empty}>No members are available.</p> : (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>MEMBER</th><th>EMAIL</th><th>ROLE</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>{members.map((member) => <tr key={member.userId}>
              <td><strong>{member.name}</strong></td>
              <td>{member.email}</td>
              <td>{member.role === 'owner' ? <span className={styles.roleBadge}>Owner</span> : <select aria-label={`Role for ${member.name}`} value={member.role} disabled={!canManage} onChange={(event) => void changeRole(member, event.target.value as Exclude<Role, 'owner'>)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}</td>
              <td><span className={member.emailVerified ? styles.verified : styles.pending}>{member.emailVerified ? 'Verified' : 'Unverified'}</span></td>
              <td className={styles.actions}>{currentRole === 'owner' && member.role !== 'owner' && <button type="button" onClick={() => void transferOwnership(member)}>Transfer ownership</button>}{member.role !== 'owner' && <button type="button" className={styles.danger} disabled={!canManage} onClick={() => void removeMember(member)}>Remove</button>}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      {canManage && <>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Invite a teammate</h2><p>Invitations expire after seven days and can be revoked.</p></div></div>
          <form className={styles.inviteForm} onSubmit={sendInvitation}>
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" /></label>
            <label>Organization role<select value={role} onChange={(event) => setRole(event.target.value as Exclude<Role, 'owner'>)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
          </form>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Pending invitations</h2><p>Only unexpired invitations are shown.</p></div></div>
          {invitations.length === 0 ? <p className={styles.empty}>No pending invitations.</p> : <ul className={styles.invitationList}>{invitations.map((invitation) => <li key={invitation.id}><div><strong>{invitation.email}</strong><span>{roleOptions.find((item) => item.value === invitation.role)?.label} · Expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div><button type="button" className={styles.danger} onClick={() => void revokeInvitation(invitation)}>Revoke</button></li>)}</ul>}
        </section>
      </>}
    </section>
  );
}
