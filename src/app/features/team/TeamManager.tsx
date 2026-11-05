'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { crmApiFetch } from '../../../lib/api-client';

type Member = { id: string; name: string; email: string; role: string; isCurrentUser: boolean };
type Invitation = { id: string; email: string; role: string; expiresAt: string };
type TeamData = { members: Member[]; invitations: Invitation[]; planCode: string | null; currentRole: string };

const plans: Record<string, { name: string; seats: number }> = {
  starter: { name: 'Starter', seats: 3 },
  growth: { name: 'Growth', seats: 10 },
  business: { name: 'Business', seats: 25 },
};

const roles = [
  { value: 'sales_rep', label: 'Sales rep' },
  { value: 'sales_manager', label: 'Sales manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'read_only', label: 'Read only' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getApiMessage(payload: unknown, status: number) {
  if (isRecord(payload)) {
    const error = isRecord(payload.error) ? payload.error : null;
    const message = error?.message ?? payload.message;
    if (typeof message === 'string') return message;
  }
  return `Request failed (HTTP ${status}). Please try again.`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (caught) {
    if (caught instanceof SyntaxError) {
      throw new Error(`The CRM API returned an invalid response (HTTP ${response.status}).`);
    }
    throw caught;
  }
}

function parseTeamData(membersPayload: unknown, invitationsPayload: unknown, billingPayload: unknown): TeamData {
  if (!isRecord(membersPayload) || !Array.isArray(membersPayload.data)) {
    throw new Error('The members API returned an invalid response.');
  }
  if (!isRecord(invitationsPayload) || !Array.isArray(invitationsPayload.data)) {
    throw new Error('The invitations API returned an invalid response.');
  }
  if (!isRecord(billingPayload) || !isRecord(billingPayload.data) || !isRecord(billingPayload.data.subscription)) {
    throw new Error('The billing API returned an invalid response.');
  }

  const members: Member[] = membersPayload.data.map((value): Member => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.email !== 'string' || typeof value.role !== 'string' || typeof value.isCurrentUser !== 'boolean') {
      throw new Error('The members API returned an invalid member.');
    }
    return { id: value.id, name: value.name, email: value.email, role: value.role, isCurrentUser: value.isCurrentUser };
  });
  const invitations: Invitation[] = invitationsPayload.data.map((value): Invitation => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.email !== 'string' || typeof value.role !== 'string' || typeof value.expiresAt !== 'string') {
      throw new Error('The invitations API returned an invalid invitation.');
    }
    return { id: value.id, email: value.email, role: value.role, expiresAt: value.expiresAt };
  });
  const planCode = billingPayload.data.subscription.planCode;
  if (planCode !== null && typeof planCode !== 'string') {
    throw new Error('The billing API returned an invalid plan.');
  }
  const currentRole = billingPayload.data.organizationRole;
  if (typeof currentRole !== 'string') throw new Error('The billing API returned an invalid organization role.');
  return { members, invitations, planCode, currentRole };
}

export default function TeamManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_rep');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const responses = await Promise.all([
          crmApiFetch('/organizations/members', { signal: controller.signal }),
          crmApiFetch('/organizations/invitations', { signal: controller.signal }),
          crmApiFetch('/billing/current', { signal: controller.signal }),
        ]);
        const payloads = await Promise.all(responses.map(readJson));
        const failedResponse = responses.find((response) => !response.ok);
        if (failedResponse) throw new Error(getApiMessage(payloads[responses.indexOf(failedResponse)], failedResponse.status));
        const teamData = parseTeamData(payloads[0], payloads[1], payloads[2]);
        if (!cancelled) {
          setMembers(teamData.members);
          setInvitations(teamData.invitations);
          setPlanCode(teamData.planCode);
          setCurrentRole(teamData.currentRole);
        }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === 'AbortError')) return;
        setError(caught instanceof Error ? caught.message : 'Could not load team details.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refresh]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/organizations/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(getApiMessage(payload, response.status));
      if (!isRecord(payload) || !isRecord(payload.data) || typeof payload.data.email !== 'string') {
        throw new Error('The invitations API returned an invalid response.');
      }
      setNotice(`Invitation created for ${payload.data.email}. Invitation emails are not configured in this app.`);
      setInviteEmail('');
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    await runAction(`/organizations/memberships/${member.id}`, 'DELETE', `Removed ${member.name} from the workspace.`);
  }

  async function revokeInvitation(invitation: Invitation) {
    await runAction(`/organizations/invitations/${invitation.id}`, 'DELETE', `Revoked the invitation for ${invitation.email}.`);
  }

  async function updateRole(member: Member, role: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch(`/organizations/memberships/${member.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(getApiMessage(payload, response.status));
      setNotice(`Updated ${member.name}'s role.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the member role.');
    } finally {
      setBusy(false);
    }
  }

  async function transferOwnership(member: Member) {
    if (!window.confirm(`Transfer workspace ownership to ${member.name}? You will become an administrator.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/organizations/transfer-ownership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId: member.id }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(getApiMessage(payload, response.status));
      setNotice(`Workspace ownership transferred to ${member.name}.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not transfer ownership.');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(path: string, method: 'DELETE', successMessage: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch(path, { method });
      if (!response.ok) {
        const payload = await readJson(response);
        throw new Error(getApiMessage(payload, response.status));
      }
      setNotice(successMessage);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not complete this action.');
    } finally {
      setBusy(false);
    }
  }

  const plan = planCode ? plans[planCode] : undefined;
  const canManageMembers = currentRole === 'owner' || currentRole === 'admin';

  return (
    <section className="team-feature">
      <div className="leads-page-heading">
        <div>
          <p className="date-label">WORKSPACE / TEAM</p>
          <h1>Team</h1>
          <p className="welcome-copy">Manage the people and invitations in your workspace.</p>
        </div>
        {canManageMembers && <a className="button button-primary" href="#team-invite">
          <span aria-hidden="true">＋</span> Invite team member
        </a>}
      </div>

      {error && <div className="leads-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
      {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}

      <section className="team-summary-grid" aria-label="Team summary">
        <article className="metric-card">
          <div className="metric-top"><span>Members</span><span className="metric-icon lavender">♙</span></div>
          <div className="metric-value">{loading ? '—' : members.length}</div>
          <div className="metric-foot"><span>Active workspace members</span></div>
        </article>
        <article className="metric-card">
          <div className="metric-top"><span>Plan</span><span className="metric-icon lavender">◷</span></div>
          <div className="metric-value">{loading ? '—' : plan?.name ?? planCode ?? 'No plan'}</div>
          <div className="metric-foot"><span>{plan ? `Up to ${plan.seats} members` : 'Current workspace plan'}</span></div>
        </article>
      </section>

      <section className="panel team-directory" aria-label="Team directory">
        <header className="panel-heading module-directory-heading">
          <div><h2>Team members</h2><p>{loading ? 'Loading members…' : `${members.length} active ${members.length === 1 ? 'member' : 'members'}`}</p></div>
        </header>
        {loading ? (
          <p className="team-state">Loading team members…</p>
        ) : members.length === 0 ? (
          <p className="team-state">No team members found.</p>
        ) : (
          <div className="team-table-scroll">
            <table className="team-table">
              <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="team-primary-cell">{member.name}</td>
                    <td>{member.email}</td>
                    <td className="team-capitalize">
                      {canManageMembers && member.role !== 'owner' && !member.isCurrentUser
                        ? <select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy} onChange={(event) => void updateRole(member, event.target.value)}>
                            {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                          </select>
                        : member.role.replace(/_/g, ' ')}
                    </td>
                    <td>
                      {canManageMembers && member.role !== 'owner' && !member.isCurrentUser &&
                        <button className="team-row-action" type="button" disabled={busy} onClick={() => void removeMember(member)}>Remove</button>}
                      {currentRole === 'owner' && member.role !== 'owner' &&
                        <button className="team-row-action" type="button" disabled={busy} onClick={() => void transferOwnership(member)}>Transfer ownership</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel team-directory" aria-label="Pending invitations">
        <header className="panel-heading module-directory-heading">
          <div><h2>Pending invitations</h2><p>{loading ? 'Loading invitations…' : `${invitations.length} pending ${invitations.length === 1 ? 'invitation' : 'invitations'}`}</p></div>
        </header>
        {loading ? (
          <p className="team-state">Loading invitations…</p>
        ) : invitations.length === 0 ? (
          <p className="team-state">No pending invitations.</p>
        ) : (
          <div className="team-table-scroll">
            <table className="team-table">
              <thead><tr><th>EMAIL</th><th>ROLE</th><th>EXPIRES</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="team-primary-cell">{invitation.email}</td>
                    <td><span className="team-invitation-role">{invitation.role.replace(/_/g, ' ')}</span></td>
                    <td>{new Date(invitation.expiresAt).toLocaleDateString()}</td>
                    <td><button className="team-row-action" type="button" disabled={busy} onClick={() => void revokeInvitation(invitation)}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManageMembers && <section className="panel team-invite-panel" id="team-invite" aria-label="Invite a team member">
        <header className="panel-heading">
          <div><h2>Invite a team member</h2><p>Add someone to this workspace by email.</p></div>
        </header>
        <form className="team-invite-form" onSubmit={(event) => void invite(event)}>
          <label>Email address<input type="email" name="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@company.com" autoComplete="email" required maxLength={254} /></label>
          <label>Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>{roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
          <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
        </form>
        <p className="team-invite-note">This creates a pending invitation. The app does not currently email invitations.</p>
      </section>}
    </section>
  );
}
