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

export default function ForgotPasswordPage() {
  const [token, setToken] = useState('');
  const [isReset, setIsReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const resetToken = new URLSearchParams(window.location.search).get('token');
    if (resetToken) {
      setToken(resetToken);
      setIsReset(true);
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const endpoint = isReset ? '/auth/reset-password' : '/auth/request-password-reset';
      const body = isReset
        ? { token, password: values.password }
        : { email: values.email };
      const response = await crmApiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(messageFrom(payload, 'The request could not be completed.'));
      if (isReset) {
        setNotice('Your password has been updated. Sign in with your new password.');
      } else {
        const result = typeof payload === 'object' && payload !== null ? payload : {};
        if ('resetToken' in result && typeof result.resetToken === 'string') {
          setToken(result.resetToken);
          setIsReset(true);
          setNotice('Development reset token loaded. Choose a new password below.');
        } else {
          setNotice('If an account exists for that email, a password reset link has been sent.');
        }
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
          <h2>{isReset ? 'Choose a new password' : 'Reset your password'}</h2>
          <p className="auth-subtitle">{isReset ? 'Set a new password for your Myr CRM account.' : 'Enter your account email and we will send a secure reset link.'}</p>
          <form className="auth-form" onSubmit={submit}>
            {isReset
              ? <>
                  <label htmlFor="reset-password">New password</label>
                  <input id="reset-password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
                </>
              : <>
                  <label htmlFor="reset-email">Work email</label>
                  <input id="reset-email" name="email" type="email" required autoComplete="email" />
                </>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            {notice && <p role="status">{notice}</p>}
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : isReset ? 'Update password' : 'Send reset link'}</button>
          </form>
          <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
