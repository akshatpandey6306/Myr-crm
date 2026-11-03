
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../lib/api-client';

type Member = { id: string; name: string; email: string; role: string };
type Invitation = { id: string; email: string; role: string; expiresAt: string; createdAt: string };

const SEAT_LABELS: Record<string, string> = {
  starter: 'up to 3 members',
  growth: 'up to 10 members',
  business: 'up to 25 members',
};

const ROLES = ['sales_rep', 'sales_manager', 'admin'] as const;

const planSeats: Record<string, number> = { starter: 3, growth: 10, business: 25 };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [seats, setSeats] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('sales_rep');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [membersRes, invitesRes, billingRes] = await Promise.all([
        crmApiFetch('/organizations/members'),
        crmApiFetch('/organizations/invitations'),
        crmApiFetch('/billing/current'),
      ]);
      const membersPayload = await membersRes.json();
      const invitesPayload = await invitesRes.json();
      const billingPayload = await billingRes.json();
      if (!membersRes.ok) throw new Error((membersPayload as any)?.error?.message || 'Could not load members.');
      if (!invitesRes.ok) throw new Error((invitesPayload as any)?.error?.message || 'Could not load invitations.');
      setMembers((membersPayload as any).data ?? []);
      setInvitations((invitesPayload as any).data ?? []);
      const sub = (billingPayload as any)?.data?.subscription;
      setPlanCode(sub?.planCode ?? null);
      setSeats(sub?.planCode ? (planSeats[sub.planCode] ?? null) : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load team data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function invite(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setMemberErrors((current) => ({ ...current, invite: '' }));
    try {
      const response = await crmApiFetch('/organizations/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: invokeRole }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = (payload as any)?.error?.message || 'Could not send invitation.';
        setMemberErrors((current) => ({ ...current, invite: message }));
        throw new Error(message);
      }
      setNotice('Invitation sent to ' + inviteEmail + '.');
      setInviteEmail('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(memberId: string, memberName: string) {
    // Handle member removal
  }

  async function revokeInvitation(invitationId: string) {
    // Handle invitation revocation
  }

  return (
    <main className="app-shell">
      <section className="panel module-team" aria-label="Team management">
        <div className="panel-heading module-team-heading">
          <div>
            <h2>Team</h2>
            <p>{seats?.toString() || ''} of {planCode?.replace('_', ' ') || ''} seats</p>
          </div>
          <div className="module-heading-actions">
            <Link href="/invite" className="button button-primary">
              Invite team member
            </Link>
          </div>
        </div>

        <section className="panel module-team-members" aria-label="Team members">
          <div className="metric-grid module-metrics">
            <article className="metric-card">
              <div className="metric-top">
                <span>Members</span>
                <span className="metric-icon purple">↗</span>
              </div>
              <div className="metric-value">{members.length}</div>
              <div className="metric-foot">
                <span>{SEAT_LABELS[planCode as keyof typeof SEAT_LABELS] || ''}</span>
              </div>
            </article>
            <article className="metric-card">
              <div className="metric-top">
                <span>Plan</span>
                <span className="metric-icon purple">◷</span>
              </div>
              <div className="metric-value">{planCode || 'Starter'}</div>
              <div className="metric-foot">
                <span>Active subscription</span>
              </div>
            </article>
          </div>
        </section>

        <section className="panel module-team-directory" aria-label="Team directory">
          <div className="panel-heading module-directory-heading">
            <div>
              <h2>Team members</h2>
              <p>{members.length} team members</p>
            </div>
            <div className="module-heading-actions">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid #e2dff0', borderRadius: 6, background: '#fff', color: '#5f2e7a', font: 'inherit', fontSize: 11 }}
                aria-label="Select role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <section style={{ background: '#fff', border: '1px solid #e8ece8', borderRadius: 12, padding: 20 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12x' }}>Pending invitations <span style={{ fontSize: 12, color: '#85849a', fontWeight: 500 }}>({invitations.length})</span></h2>
            {loading ? (
              <p style={{ color: '#85849a' }}>Loading…</p>
            ) : invitations.length === 0 ? (
              <p style={{ color: '#85849a' }}>No pending invitations.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e3ebe6' }}>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: '#8a889d', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>EMAIL</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: '#8a889d', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>ROLE</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: '#8a889d', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>EXPIRES</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', color: '#8a889d', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f0f3f0' }}>{inv.email}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f0f3f0' }}>
                        <span style={{ display: 'inline-block', borderRadius: '20px', padding: '4px 9px', fontSize: 10, fontWeight: 700, color: '#fff', background: '#8254c7', textTransform: 'capitalize' }}>
                          {inv.role.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f0f3f0' }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                      <td style={{ padding: '9px 10px', borderBottom: '1px solid #f0f3f0' }}>
                        <button
                          onClick={() => revokeInvitation(inv.id)}
                          disabled={busy}
                          style={{ padding: '6px 10px', border: '1px solid #e2dff0', borderRadius: 6, background: '#fff', color: '#8a889d', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </section>

        <section className="panel module-team-actions" aria-label="Team actions">
          <div className="panel-heading">
            <div>
              <h2>Add members</h2>
              <p>Invite new team members to your workspace</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              invite(event);
            }}
            style={{ maxWidth: 400 }}
          >
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email"
                style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2dff0', borderRadius: 6, background: '#fff', fontSize: 11 }}
                required
                aria-label="Invite email"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #e2dff0', borderRadius: 6, background: '#fff', color: '#5f2e7a', font: 'inherit', fontSize: 11 }}
                aria-label="Select role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={busy}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #8254c7', borderRadius: 6, background: '#8254c7', color: '#fff', fontSize: 11, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer' }}
            >
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
        </section>
      </section>

      <footer className="page-footer">
        <span>MYR CRM <i /> Workspace</span>
        <span>Preview build · Sample data</span>
      </footer>
    </main>
  );
}
