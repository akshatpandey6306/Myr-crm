'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type AuthMode = 'signin' | 'signup';

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const isSignup = mode === 'signup';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await crmApiFetch(`/auth/${isSignup ? 'signup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message ?? payload?.message ?? 'We could not sign you in. Check your details and try again.';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
      }
      if (isSignup) {
        setSuccess(payload.verificationRequired
          ? payload.message ?? 'Check your email to verify your account before signing in.'
          : payload.message ?? 'Your workspace is ready. Sign in to continue.');
        return;
      }
      sessionStorage.setItem('myr.user', JSON.stringify(payload.user));
      if (payload.organization) sessionStorage.setItem('myr.organization', JSON.stringify(payload.organization));
      window.location.assign('/');
    } catch (caught) {
      setError(caught instanceof Error && caught.message.includes('fetch')
        ? 'Could not reach the CRM API. Start the API server and try again.'
        : caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="brand auth-brand" href="/"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
        <div className="auth-story-copy"><span className="auth-eyebrow">YOUR CUSTOMER RELATIONSHIPS, IN SYNC</span><h1>Make every<br />connection count.</h1><p>Bring your pipeline, people, and next steps together in one calm workspace.</p><div className="auth-story-visual" aria-hidden="true"><span className="auth-orbit auth-orbit-one" /><span className="auth-orbit auth-orbit-two" /><span className="auth-orbit auth-orbit-three" /><span className="auth-visual-card"><i /><i /><i /></span></div></div>
        <span className="auth-story-foot">MYR CRM <i /> Built for teams that care.</span>
      </section>
      <section className="auth-main"><div className="auth-card"><div className="auth-mobile-brand"><Link className="brand" href="/"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link></div><span className="auth-step">{isSignup ? 'GET STARTED' : 'WELCOME BACK'}</span><h2>{isSignup ? 'Create your workspace' : 'Sign in to Myr'}</h2><p className="auth-subtitle">{isSignup ? 'Start organizing your team’s customer relationships.' : 'Pick up where you left off with your team.'}</p>
        <form className="auth-form" method="post" onSubmit={submit}>
          {hydrated ? <>
          {isSignup && <><label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" type="text" autoComplete="name" placeholder="Maya Chen" required minLength={2} /><label htmlFor="auth-org">Workspace name</label><input id="auth-org" name="organizationName" type="text" placeholder="Studio North" required minLength={2} />
          </>}
          <label htmlFor="auth-email">Work email</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          <div className="auth-password-label"><label htmlFor="auth-password">Password</label>{!isSignup && <Link href="/sign-up">Need an account?</Link>}</div>
          <div className="auth-password-wrap"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div>
          {error && <div className="auth-error" role="alert">{error}{error.includes('Verify your email') && <> <Link href="/verify-email">Resend verification email</Link></>}</div>}
          {success && <div className="auth-success" role="status">{success} <Link href="/sign-in">Go to sign in</Link></div>}
          <button className="auth-submit" type="submit" disabled={busy || Boolean(success)}>{busy ? <><span className="auth-spinner" /> {isSignup ? 'Creating workspace…' : 'Signing in…'}</> : <>{isSignup ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></>}</button>
          </> : <p className="auth-form-loading" role="status">Preparing secure sign-in…</p>}
        </form>
        {!isSignup && <p className="auth-switch"><Link href="/forgot-password">Forgot your password?</Link></p>}
        <p className="auth-switch">{isSignup ? 'Already have an account?' : 'New to Myr?'} <Link href={isSignup ? '/sign-in' : '/sign-up'}>{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
        <p className="auth-footnote">By continuing, you agree to your workspace’s terms and privacy policy.</p>
      </div><span className="auth-copyright">© 2026 Myr CRM · Secure workspace access</span></section>
    </main>
  );
}
