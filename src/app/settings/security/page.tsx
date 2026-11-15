'use client';

import { useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';

type Session = { id: string; deviceLabel: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };

export default function SecuritySettingsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await crmApiFetch('/auth/sessions');
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload?.data)) throw new Error(payload?.error?.message ?? 'Could not load active sessions.');
      setSessions(payload.data as Session[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load active sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await crmApiFetch(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not revoke that session.');
      setMessage('Session signed out.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke that session.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await crmApiFetch('/auth/sessions/revoke-others', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not sign out other sessions.');
      setMessage(`${payload.data.revokedCount} other session(s) signed out.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign out other sessions.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="settings-route-content">
    <p className="welcome-copy">Review the browsers and devices currently signed in to your account. You can revoke any session you do not recognize.</p>
    {error && <p role="alert" className="leads-error">{error}</p>}
    {message && <p role="status" className="control-panel-success">{message}</p>}
    <section className="panel control-panel-table" aria-label="Your active sessions">
      <div className="panel-heading"><div><h2>Active devices</h2><p>Sessions expire automatically based on the platform security policy.</p></div><button className="control-panel-action" type="button" disabled={busy || loading} onClick={() => void revokeOthers()}>Sign out other sessions</button></div>
      {loading ? <p className="control-panel-empty" role="status">Loading sessions…</p> : <div className="table-scroll"><table><thead><tr><th>DEVICE</th><th>LAST ACTIVE</th><th>SIGNED IN</th><th>EXPIRES</th><th>ACTION</th></tr></thead><tbody>
        {sessions.map((session) => <tr key={session.id}><td>{session.deviceLabel ?? 'Unknown device'}{session.current && <small>Current session</small>}{session.userAgent && <small>{session.userAgent}</small>}</td><td>{new Date(session.lastSeenAt).toLocaleString()}</td><td>{new Date(session.createdAt).toLocaleString()}</td><td>{new Date(session.expiresAt).toLocaleString()}</td><td><button className="control-panel-action" type="button" disabled={busy} onClick={() => void revoke(session.id)}>{session.current ? 'Sign out this device' : 'Sign out'}</button></td></tr>)}
        {!sessions.length && <tr><td className="control-panel-empty" colSpan={5}>No active sessions.</td></tr>}
      </tbody></table></div>}
    </section>
  </main>;
}
