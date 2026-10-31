'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../lib/api-client';

type Member = { id: string; name: string; role: string };
type Invitation = { id: string; email: string; role: string; expiresAt: string; createdAt: string };

const roles = ['sales_rep', 'sales_manager', 'admin'] as const;
const planSeats: Record<string, number> = { starter: 3, growth: 10, business: 25 };

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [seats, setSeats] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_rep');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

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

  useEffect(() => { load(); }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/organizations/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error((payload as any)?.error?.message || 'Could not send invitation.');
      setNotice('Invitation sent to ' + inviteEmail + '.');
      setInviteEmail('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    try {
      const response = await crmApiFetch('/organizations/invitations/' + id, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as any)?.error?.message || 'Could not revoke invitation.');
      }
      setNotice('Invitation revoked.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke invitation.');
    } finally {
      setBusy(false);
    }
  }

  const used = members.length + invitations.length;

  return (
    <main style={{ minHeight: '100vh', background: '#f7f9f7', color: '#263c35', fontFamily: 'inherit', display: 'flex' }}>
      <aside style={{ width: 286, background: '#fff', borderRight: '1px solid #e3ebe6', padding: 22, boxSizing: 'border-box' }}>
        <Link href='/' style={{ fontSize: 22, fontWeight: 800, color: '#26283a', textDecoration: 'none' }}>myr<span style={{ color: '#2b7a62' }}>.</span></Link>
        <p style={{ fontSize: 12, color: '#9295a3', margin: '26px 0 18px' }}>STUDIO NORTH · WORKSPACE</p>
        {['Overview','Leads','Contacts','Companies','Deals','Activities','Team','Automation','Reports'].map((name) => (
          <Link key={name} href={name === 'Overview' ? '/' : '/' + name.toLowerCase()} style={{ display: 'block', padding: '11px 12px', margin: '4px 0', borderRadius: 8, textDecoration: 'none', fontSize: 14, color: name === 'Team' ? '#236b55' : '#666a79', background: name === 'Team' ? '#edf5f0' : 'transparent', fontWeight: name === 'Team' ? 700 : 500 }}>
            {name}
          </Link>
        ))}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <header style={{ height: 62, background: '#fff', borderBottom: '1px solid #e3ebe6', display: 'flex', alignItems: 'center', padding: '0 34px', fontSize: 13, color: '#9396a4' }}>
          Workspace / <b style={{ color: '#343649', marginLeft: 6 }}>Team</b>
          <span style={{ marginLeft: 'auto' }}>Maya Chen</span>
        </header>
        <div style={{ maxWidth: 1150, margin: 'auto', padding: '42px 34px' }}>
          <p style={{ fontSize: 10, letterSpacing: 1.4, color: '#8f91a0', fontWeight: 700 }}>WORKSPACE / TEAM</p>
          <h1 style={{ fontSize: 30, margin: '8px 0 6px', color: '#263c35' }}>Team members</h1>
          <p style={{ color: '#6b736f', marginBottom: 24 }}>Invite teammates and manage access. Plan: <b>{planCode ?? '—'}</b> · Seats: {seats ? used + ' of ' + seats : used}</p>
          {error && <p style={{ color: '#b91c1c', marginBottom: 12 }}>{error}</p>}
          {notice && <p style={{ color: '#166534', marginBottom: 12 }}>{notice}</p>}
          <section style={{ background: '#fff', border: '1px solid #e3ebe6', borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Invite a teammate</h2>
            <form onSubmit={invite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: 1, minWidth: 220 }}>Email<input type='email' value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required placeholder='teammate@company.com' style={{ width: '100%', padding: '8px 10px', border: '1px solid #dfe5e0', borderRadius: 8 }} /></label>
              <label>Role<select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{ padding: '8px 10px', border: '1px solid #dfe5e0', borderRadius: 8 }}>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select></label>
              <button type='submit' disabled={busy} style={{ padding: '8px 16px', background: '#2b7a62', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{busy ? 'Sending…' : 'Send invite'}</button>
            </form>
          </section>
          <section style={{ background: '#fff', border: '1px solid #e3ebe6', borderRadius: 12, padding: 20, marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Active members ({members.length})</h2>
            {loading ? <p>Loading…</p> : members.length === 0 ? <p>No members yet.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e3ebe6' }}>Name</th><th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e3ebe6' }}>Role</th></tr></thead>
                <tbody>{members.map((m) => (
                  <tr key={m.id}><td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}>{m.name}</td><td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}>{m.role}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <section style={{ background: '#fff', border: '1px solid #e3ebe6', borderRadius: 12, padding: 20 }}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Pending invitations ({invitations.length})</h2>
            {loading ? <p>Loading…</p> : invitations.length === 0 ? <p>No pending invitations.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e3ebe6' }}>Email</th><th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e3ebe6' }}>Role</th><th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e3ebe6' }}>Expires</th><th style={{ padding: 8, borderBottom: '1px solid #e3ebe6' }}></th></tr></thead>
                <tbody>{invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}>{inv.email}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}>{inv.role}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    <td style={{ padding: 8, borderBottom: '1px solid #f0f3f0' }}><button onClick={() => revoke(inv.id)} disabled={busy} style={{ padding: '4px 10px', background: '#fff', border: '1px solid #dfe5e0', borderRadius: 6, cursor: 'pointer' }}>Revoke</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
