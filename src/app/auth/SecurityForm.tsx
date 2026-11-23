'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Mode = 'forgot' | 'reset' | 'verify' | 'activate';

const headings: Record<Mode, { title: string; description: string; submit: string }> = {
  forgot: {
    title: 'Reset your password',
    description: 'Enter the email address on your account and we’ll send a reset link if it is eligible.',
    submit: 'Send reset link',
  },
  reset: {
    title: 'Choose a new password',
    description: 'Use a new password with at least 8 characters.',
    submit: 'Update password',
  },
  verify: {
    title: 'Verify your email',
    description: 'Confirm your email address to activate sign-in, or request a new verification link.',
    submit: 'Continue',
  },
  activate: {
    title: 'Set up your LeadPilot account',
    description: 'Choose a password to accept your invitation and activate workspace access.',
    submit: 'Activate account',
  },
};

export default function SecurityForm({ mode, token = '' }: { mode: Mode; token?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (mode === 'reset' && values.password !== values.confirmPassword) {
      setError('The new passwords do not match.');
      setBusy(false);
      return;
    }
    const action = mode === 'forgot'
      ? 'password-reset/request'
      : mode === 'reset'
        ? 'password-reset/confirm'
        : mode === 'activate'
          ? 'account-activation'
        : token
          ? 'email-verification/confirm'
          : 'email-verification/resend';
    const body = mode === 'reset' || mode === 'activate' || (mode === 'verify' && token)
      ? { ...values, token }
      : values;

    try {
      const path = `/auth/${action}`;
      const response = await crmApiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message ?? payload?.message ?? 'We could not complete this request.';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
      }
      setSuccess(payload.message ?? 'Your request is complete.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const heading = headings[mode];
  if (mode === 'forgot') return <>
    <span className="premium-auth-eyebrow">ACCOUNT RECOVERY</span>
    <h1 className="premium-auth-heading">{heading.title}</h1>
    <p className="premium-auth-copy">{heading.description}</p>
    <form className="auth-form premium-auth-form" onSubmit={submit}>
      <label htmlFor="security-email">Work email</label>
      <input id="security-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
      {error && <div className="auth-error premium-auth-error" role="alert">{error}</div>}
      {success && <div className="auth-success premium-auth-success" role="status">{success}</div>}
      <button className="auth-submit premium-auth-submit" type="submit" disabled={busy || Boolean(success)}>{busy ? <><span className="auth-spinner" /> Sending reset link…</> : 'Send reset link'}<span aria-hidden="true">→</span></button>
    </form>
    <p className="auth-switch premium-auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
  </>;
  return (
    <main className="auth-page auth-security-page">
      <section className="auth-main">
        <div className="auth-card">
          <Link className="brand auth-brand" href="/"><img className="brand-partner-logo" src="/leadpilot-advance-solution-white.svg" alt="LeadPilot Advance Solution" /></Link>
          <span className="auth-step">ACCOUNT SECURITY</span>
          <h2>{heading.title}</h2>
          <p className="auth-subtitle">{heading.description}</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'verify' && !token && <>
              <label htmlFor="security-email">Work email</label>
              <input id="security-email" name="email" type="email" autoComplete="email" required />
            </>}
            {(mode === 'reset' || mode === 'activate') && <>
              <label htmlFor="security-password">New password</label>
              <input id="security-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required />
              {mode === 'reset' && <><label htmlFor="security-confirm-password">Confirm new password</label><input id="security-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></>}
            </>}
            {error && <div className="auth-error" role="alert">{error}</div>}
            {success && <div className="auth-success" role="status">{success}</div>}
            <button className="auth-submit" type="submit" disabled={busy || Boolean(success)}>
              {busy ? 'Please wait…' : heading.submit}
            </button>
          </form>
          <p className="auth-switch"><Link href="/sign-in">Back to sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
