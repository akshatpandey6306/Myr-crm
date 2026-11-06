'use client';

import { useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from './MembersManager.module.css';

type Role = 'owner' | 'admin' | 'sales_manager' | 'sales_rep' | 'read_only';
type Member = { userId: string; name: string; email: string; role: Role; emailVerified: boolean; joinedAt: string };
type MembershipRequest = { userId: string; name: string; email: string; requestedAt: string };

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
  const [requests, setRequests] = useState<MembershipRequest[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membersResponse, requestsResponse, joinCodeResponse, meResponse] = await Promise.all([
        crmApiFetch('/organizations/members'),
        crmApiFetch('/organizations/membership-requests'),
        crmApiFetch('/organizations/join-code'),
        crmApiFetch('/auth/me'),
      ]);
      const [membersPayload, requestsPayload, joinCodePayload, mePayload] = await Promise.all([
        responseMessage(membersResponse),
        responseMessage(requestsResponse),
        responseMessage(joinCodeResponse),
        responseMessage(meResponse),
      ]);
      setMembers(membersPayload.data as Member[]);
      setRequests(requestsPayload.data as MembershipRequest[]);
      setJoinCode(joinCodePayload.data.joinCode as string);
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

  async function reviewRequest(joinRequest: MembershipRequest, decision: 'approve' | 'decline') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/membership-requests/${joinRequest.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }));
      setNotice(`${joinRequest.name}'s request was ${decision === 'approve' ? 'approved' : 'declined'}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not review this request.');
    } finally {
      setBusy(false);
    }
  }

  const canManage = currentRole === 'owner' || currentRole === 'admin';
  return (
    <section className={styles.manager}>
      <header className={styles.heading}>
        <div><p className="date-label">WORKSPACE / TEAM</p><h1>Team & access</h1><p className="welcome-copy">Review join requests and manage your workspace members.</p></div>
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
              <td><span className={styles.verified}>Active</span></td>
              <td className={styles.actions}>{currentRole === 'owner' && member.role !== 'owner' && <button type="button" onClick={() => void transferOwnership(member)}>Transfer ownership</button>}{member.role !== 'owner' && <button type="button" className={styles.danger} disabled={!canManage} onClick={() => void removeMember(member)}>Remove</button>}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      {canManage && <>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Workspace join code</h2><p>Share this code with teammates. They can request access when creating an account.</p></div></div>
          <p className={styles.joinCode}>{joinCode || 'Loading workspace code…'}</p>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Join requests</h2><p>{requests.length} waiting for workspace admin approval.</p></div></div>
          {requests.length === 0 ? <p className={styles.empty}>No pending requests.</p> : <ul className={styles.invitationList}>{requests.map((joinRequest) => <li key={joinRequest.userId}><div><strong>{joinRequest.name}</strong><span>{joinRequest.email} · Requested {new Date(joinRequest.requestedAt).toLocaleDateString()}</span></div><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void reviewRequest(joinRequest, 'approve')}>Approve</button><button type="button" className={styles.danger} disabled={busy} onClick={() => void reviewRequest(joinRequest, 'decline')}>Decline</button></div></li>)}</ul>}
        </section>
      </>}
    </section>
  );
}
