'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

function messageFrom(payload: unknown, fallback: string) {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return fallback;
  const error = payload.error;
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

export default function VerifyEmailPage() {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(payload, 'Could not verify this email address.'));
      setNotice('Your email is verified. You can now access your workspace.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/auth/resend-verification', { method: 'POST' });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(payload, 'Could not send a verification email.'));
      const result = typeof payload === 'object' && payload !== null ? payload : {};
      if ('emailVerificationToken' in result && typeof result.emailVerificationToken === 'string') {
        setToken(result.emailVerificationToken);
        setNotice('Development verification token loaded. Submit it above to verify your account.');
      } else {
        setNotice('If your account still needs verification, a new link has been sent to your email.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-main">
        <div className="auth-card">
          <Link className="brand auth-mobile-brand" href="/"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
          <span className="auth-step">ACCOUNT SECURITY</span>
          <h2>Verify your email</h2>
          <p className="auth-subtitle">Use the secure link sent to your email. You can request another link if needed.</p>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="verification-token">Verification token</label>
            <input id="verification-token" name="token" value={token} onChange={(event) => setToken(event.target.value)} required autoComplete="one-time-code" />
            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <p role="status">{notice}</p>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify email'}</button>
          </form>
          <button className="auth-submit" type="button" disabled={busy} onClick={() => void resend()}>Resend verification email</button>
          <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
