'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type AuthMode = 'signin' | 'signup';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const isSignup = mode === 'signup';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const demoCredentials = [
    { label: 'Active workspace (Maya)', email: 'maya@studionorth.co', password: 'password123' },
    { label: 'Platform admin', email: 'admin@myrcrm.local', password: 'MyrAdmin123!' },
    { label: 'Pending subscription', email: 'pending@myrcrm.local', password: 'PendingDemo123!' },
    { label: 'Expired trial', email: 'expired@myrcrm.local', password: 'ExpiredDemo123!' },
  ];

  async function quickSignIn(email: string, password: string) {
    setBusy(true);
    setError('');
    try {
      const response = await crmApiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('Invalid response from API.'); }
      if (!response.ok) {
        const body = isRecord(payload) ? payload : {};
        const apiError = isRecord(body.error) ? body.error : {};
        const message = typeof apiError.message === 'string' ? apiError.message : 'Sign in failed.';
        throw new Error(message);
      }
      if (!isRecord(payload) || !isRecord(payload.user)) throw new Error('Incomplete response.');
      sessionStorage.removeItem('myr.session');
      sessionStorage.removeItem('myr.organization');
      sessionStorage.setItem('myr.user', JSON.stringify(payload.user));
      if (isRecord(payload.organization)) sessionStorage.setItem('myr.organization', JSON.stringify(payload.organization));
      const controlPanelResponse = await crmApiFetch('/control-panel/access');
      if (controlPanelResponse.ok) window.location.assign('/control-panel');
      else if (controlPanelResponse.status === 403) window.location.assign('/');
      else throw new Error(`Could not verify account access (HTTP ${controlPanelResponse.status}).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

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
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (caught) {
        if (!(caught instanceof SyntaxError)) throw caught;
        throw new Error(`The CRM API returned an empty or invalid response (HTTP ${response.status}). Check that the API server is running and try again.`);
      }
      if (!response.ok) {
        const body = isRecord(payload) ? payload : {};
        const apiError = isRecord(body.error) ? body.error : {};
        const message = apiError.message ?? body.message;
        const errorMessage = typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? message.filter((item): item is string => typeof item === 'string').join(', ')
            : '';
        throw new Error(errorMessage || 'We could not sign you in. Check your details and try again.');
      }
      if (!isRecord(payload) || !isRecord(payload.user)) {
        throw new Error('The CRM API returned an incomplete response. Check the API server logs and try again.');
      }
      sessionStorage.removeItem('myr.session');
      sessionStorage.removeItem('myr.organization');
      sessionStorage.setItem('myr.user', JSON.stringify(payload.user));
      if (isRecord(payload.organization)) sessionStorage.setItem('myr.organization', JSON.stringify(payload.organization));
      const controlPanelResponse = await crmApiFetch('/control-panel/access');
      if (controlPanelResponse.ok) {
        window.location.assign('/control-panel');
      } else if (controlPanelResponse.status === 403) {
        window.location.assign('/');
      } else {
        throw new Error(`You are signed in, but we could not verify account access (HTTP ${controlPanelResponse.status}). Try again.`);
      }
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
        <form className="auth-form" onSubmit={submit}>
          {isSignup && <><label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" type="text" autoComplete="name" placeholder="Maya Chen" required minLength={2} /><label htmlFor="auth-org">Workspace name</label><input id="auth-org" name="organizationName" type="text" placeholder="Studio North" required minLength={2} />
          </>}
          <label htmlFor="auth-email">Work email</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
          <div className="auth-password-label"><label htmlFor="auth-password">Password</label>{!isSignup && <Link href="/sign-up">Need an account?</Link>}</div>
          <div className="auth-password-wrap"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" type="submit" disabled={busy}>{busy ? <><span className="auth-spinner" /> {isSignup ? 'Creating workspace…' : 'Signing in…'}</> : <>{isSignup ? 'Create account' : 'Sign in'} <span aria-hidden="true">→</span></>}</button>
        </form>
        {isSignup ? null : (
          <div className="auth-demo-credentials">
            <p className="auth-demo-title">Quick sign-in (demo accounts)</p>
            <div className="auth-demo-grid">
              {demoCredentials.map((credential) => (
                <button
                  key={credential.email}
                  type="button"
                  className="auth-demo-button"
                  disabled={busy}
                  onClick={() => quickSignIn(credential.email, credential.password)}
                >
                  {credential.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="auth-switch">{isSignup ? 'Already have an account?' : 'New to Myr?'} <Link href={isSignup ? '/sign-in' : '/sign-up'}>{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
        <p className="auth-footnote">By continuing, you agree to your workspace’s terms and privacy policy.</p>
      </div><span className="auth-copyright">© 2026 Myr CRM · Secure workspace access</span></section>
    </main>
  );
}
