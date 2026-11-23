'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type AuthMode = 'signin' | 'signup';
type SignupType = 'workspace' | 'join';
type AuthApiPayload = {
  code?: string;
  error?: { code?: string; message?: string | string[] };
  message?: string;
  user?: unknown;
  organization?: unknown;
  isPlatformAdmin?: boolean;
};

async function readAuthPayload(response: Response): Promise<AuthApiPayload> {
  const body = await response.text();
  if (!body) return {};
  try {
    const payload: unknown = JSON.parse(body);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as AuthApiPayload : {};
  } catch {
    return {};
  }
}

export default function AuthForm({ mode }: { mode: AuthMode }) {
  const isSignup = mode === 'signup';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [signupType, setSignupType] = useState<SignupType>('workspace');
  const [pendingOtpEmail, setPendingOtpEmail] = useState('');
  const [signupComplete, setSignupComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const verifyingSignup = isSignup && Boolean(pendingOtpEmail);
    try {
      const response = await crmApiFetch(`/auth/${isSignup ? (verifyingSignup ? 'signup/verify' : 'signup') : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyingSignup ? { email: pendingOtpEmail, otp: values.otp } : isSignup ? values : { email: values.email, password: values.password }),
      });
      const payload = await readAuthPayload(response);
      if (!response.ok) {
        const code = payload?.code ?? payload?.error?.code;
        if (isSignup && signupType === 'workspace' && !verifyingSignup && code === 'signup_otp_delivery_failed') {
          setPendingOtpEmail(String(values.email ?? '').trim().toLowerCase());
        }
        const message = response.status >= 500 || code === 'internal_error'
          ? `The ${isSignup ? 'account' : 'sign-in'} service returned an error (${response.status}). Check that the API is running and its database migrations are current.`
          : payload?.error?.message ?? payload?.message ?? 'We could not sign you in. Check your details and try again.';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
      }
      if (isSignup) {
        if (verifyingSignup) {
          setSignupComplete(true);
          setPendingOtpEmail('');
          setSuccess(payload.message ?? 'Your account is verified. You can now sign in.');
        } else if (signupType === 'workspace') {
          setPendingOtpEmail(String(values.email ?? '').trim().toLowerCase());
          setSuccess(payload.message ?? 'Enter the verification code sent to the signup verification email.');
        } else {
          setSuccess(payload.message ?? 'Account created. Sign in to request access to your workspace.');
        }
        return;
      }
      sessionStorage.setItem('myr.user', JSON.stringify(payload.user));
      if (payload.organization) sessionStorage.setItem('myr.organization', JSON.stringify(payload.organization));
      window.location.assign(payload.isPlatformAdmin ? '/control-panel' : payload.organization ? '/' : '/join-workspace');
    } catch (caught) {
      setError(caught instanceof Error && caught.message.includes('fetch')
        ? 'Could not reach the CRM API. Start the API server and try again.'
        : caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resendSignupOtp() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await crmApiFetch('/auth/signup/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingOtpEmail }),
      });
      const payload = await readAuthPayload(response);
      if (!response.ok) {
        const message = payload?.error?.message ?? payload?.message ?? 'We could not send a new verification code.';
        throw new Error(Array.isArray(message) ? message.join(', ') : message);
      }
      setSuccess(payload.message ?? 'A new verification code was sent.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="premium-auth-eyebrow">{isSignup ? 'GET STARTED' : 'WELCOME BACK'}</span>
      <h2 className="premium-auth-heading">{isSignup ? 'Create your workspace' : 'Sign in to your workspace'}</h2>
      <p className="premium-auth-copy">{isSignup ? 'Create a workspace or ask your team admin for access.' : 'Pick up where you left off. Your business workspace is waiting.'}</p>
        <form className="auth-form premium-auth-form" method="post" onSubmit={submit}>
          {isSignup && !pendingOtpEmail && !signupComplete && <>
            <label htmlFor="auth-account-type">Account type</label><select id="auth-account-type" name="accountType" value={signupType} onChange={(event) => setSignupType(event.target.value as SignupType)}><option value="workspace">Create a new workspace</option><option value="join">Join an existing workspace</option></select>
            <label htmlFor="auth-name">Your name</label><input id="auth-name" name="name" type="text" autoComplete="name" placeholder="Maya Chen" required minLength={2} />
            {signupType === 'workspace'
              ? <><label htmlFor="auth-org">Workspace name</label><input id="auth-org" name="organizationName" type="text" placeholder="Studio North" required minLength={2} /></>
              : <p className="auth-subtitle">Ask your workspace admin to create your employee account. Then sign in with the work email and password they provide.</p>}
          </>}
          {isSignup
            ? pendingOtpEmail
              ? <>
                <p className="auth-subtitle">Enter the six-digit code sent to the workspace signup verification email. The code expires in 10 minutes.</p>
                <label htmlFor="auth-signup-otp">Verification code</label>
                <input id="auth-signup-otp" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
              </>
              : signupComplete ? null : <>
                <label htmlFor="auth-email">Work email</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
              </>
            : <>
              <label htmlFor="auth-email">Work email</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required />
            </>}
          {(!isSignup || (!pendingOtpEmail && !signupComplete)) && <>
            <div className="auth-password-label premium-auth-password-label"><label htmlFor="auth-password">Password</label></div>
            <div className="auth-password-wrap premium-auth-password-wrap"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} minLength={8} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></div>
          </>}
          {error && <div className="auth-error premium-auth-error" role="alert">{error}</div>}
          {success && <div className="auth-success premium-auth-success" role="status">{success} {(!isSignup || signupType === 'join' || signupComplete) && <Link href="/sign-in">Go to sign in</Link>}</div>}
          {pendingOtpEmail && <button className="auth-switch premium-auth-switch" type="button" onClick={resendSignupOtp} disabled={busy}>Resend verification code</button>}
          {!signupComplete && <button className="auth-submit premium-auth-submit" type="submit" disabled={busy || (Boolean(success) && !pendingOtpEmail)}>{busy ? <><span className="auth-spinner" /> {pendingOtpEmail ? 'Verifying…' : isSignup ? 'Creating workspace…' : 'Signing in…'}</> : <>{pendingOtpEmail ? 'Verify account' : isSignup ? 'Create account' : 'Sign in to LeadPilot'} <span aria-hidden="true">→</span></>}</button>}
        </form>
        {!isSignup && <p className="auth-switch premium-auth-switch"><Link href="/forgot-password">Forgot password?</Link></p>}
        {isSignup
          ? <p className="auth-switch premium-auth-switch">Already have an account? <Link href="/sign-in">Sign in</Link></p>
          : <p className="auth-switch premium-auth-switch">Use the work email and password provided by your workspace admin. You will only see workspaces where your account has active membership.</p>}
        <p className="auth-footnote premium-auth-footnote">By continuing, you agree to your workspace’s terms and privacy policy.</p>
    </>
  );
}
