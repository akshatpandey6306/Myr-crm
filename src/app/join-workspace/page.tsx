'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type JoinRequest = {
  organization: { id: string; name: string };
  status: 'pending' | 'active';
  requestedAt: string;
};

function message(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return 'Something went wrong. Please try again.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const value = result.error?.message ?? result.message;
  return typeof value === 'string' ? value : 'Something went wrong. Please try again.';
}

export default function JoinWorkspacePage() {
  const [joinCode, setJoinCode] = useState('');
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRequests = useCallback(async () => {
    try {
      const response = await crmApiFetch('/organizations/join-requests');
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      const data = Array.isArray(payload.data) ? payload.data as JoinRequest[] : [];
      setRequests(data);
      const approved = data.find((request) => request.status === 'active');
      if (approved) {
        sessionStorage.setItem('myr.organization', JSON.stringify(approved.organization));
        window.location.assign('/');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your workspace requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/organizations/join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setJoinCode('');
      setNotice('Request submitted. A workspace admin must approve it before you can access the team.');
      await loadRequests();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request workspace access.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page auth-security-page">
      <section className="auth-main">
        <div className="auth-card">
          <Link className="brand auth-brand" href="/"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
          <span className="auth-step">WORKSPACE ACCESS</span>
          <h2>Join a workspace</h2>
          <p className="auth-subtitle">Enter the join code shared by your workspace admin. Your request will appear in their Team &amp; access page.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="workspace-join-code">Workspace join code</label>
            <input id="workspace-join-code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} autoCapitalize="none" required />
            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <div className="auth-success" role="status">{notice}</div>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request access'}</button>
          </form>
          <section aria-label="Your join requests">
            <h3>Your requests</h3>
            {loading ? <p className="auth-subtitle">Loading requests…</p> : requests.filter((request) => request.status === 'pending').length === 0
              ? <p className="auth-subtitle">No requests are waiting for approval.</p>
              : requests.filter((request) => request.status === 'pending').map((request) => <p className="auth-subtitle" key={request.organization.id}>{request.organization.name} · Awaiting admin approval</p>)}
          </section>
          <p className="auth-switch"><Link href="/sign-in">Sign out and return to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
