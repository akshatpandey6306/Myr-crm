'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { crmApiFetch } from '../../lib/api-client';

export type WorkspaceSubscription = {
  planCode: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  provider: string | null;
};

type RenewalPlan = {
  code: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  billingInterval: 'monthly' | 'yearly';
  features: string[];
};

type ActivationRequest = {
  id: string;
  planCode: string;
  requestType: 'trial' | 'activation';
  requestedAt: string;
};

type WorkspaceAccess = {
  organizationName: string;
  subscription: WorkspaceSubscription;
  plans: RenewalPlan[];
  activationRequest: ActivationRequest | null;
  canManageBilling: boolean;
  partnerPlansUrl: string | null;
  trialExpired: boolean;
};

const SubscriptionContext = createContext<WorkspaceAccess | null>(null);
const DAY_MS = 24 * 60 * 60 * 1000;

export function subscriptionDaysRemaining(endsAt: string, now = Date.now()) {
  const endTime = new Date(endsAt).getTime();
  if (!Number.isFinite(endTime)) return null;
  return Math.max(0, Math.ceil((endTime - now) / DAY_MS));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function WorkspaceAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [access, setAccess] = useState<WorkspaceAccess | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const isUngatedRoute = [
    '/sign-in',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/join-workspace',
    '/control-panel',
  ].some((route) => pathname === route || pathname.startsWith(`${route}/`));

  useEffect(() => {
    function refreshWorkspaceAccess() {
      setLoading(true);
      setError('');
      setAccess(null);
      setRefreshKey((value) => value + 1);
    }
    window.addEventListener('myr:organization-changed', refreshWorkspaceAccess);
    return () => window.removeEventListener('myr:organization-changed', refreshWorkspaceAccess);
  }, []);

  async function signOut() {
    try {
      await crmApiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Clear this browser session even if the API is unreachable.
    }
    sessionStorage.removeItem('myr.session');
    sessionStorage.removeItem('myr.user');
    sessionStorage.removeItem('myr.organization');
    window.location.assign('/sign-in');
  }

  useEffect(() => {
    if (isUngatedRoute) {
      setAccess(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    async function checkAccess() {
      setLoading(true);
      setError('');
      try {
        const adminResponse = await crmApiFetch('/control-panel/access', { signal: controller.signal });
        if (adminResponse.ok) {
          window.location.replace('/control-panel');
          return;
        }
        if (adminResponse.status === 401) {
          window.location.assign('/sign-in');
          return;
        }
        if (adminResponse.status !== 403) {
          throw new Error('Could not verify platform administrator access.');
        }

        const response = await crmApiFetch('/billing/current', { signal: controller.signal });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch (caught) {
          if (!(caught instanceof SyntaxError)) throw caught;
          throw new Error(`The CRM API returned an empty or invalid response (HTTP ${response.status}). Check that the API server is running and try again.`);
        }
        if (response.status === 401) {
          window.location.assign('/sign-in');
          return;
        }
        if (!response.ok) {
          const body = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
          throw new Error(typeof body.message === 'string' ? body.message : 'Could not verify workspace access.');
        }
        const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
        const organization = data && isRecord(data.organization) ? data.organization : null;
        const current = data && isRecord(data.subscription) ? data.subscription : null;
        if (!data || !organization || typeof organization.name !== 'string' || !current) {
          throw new Error('The billing API returned an invalid response.');
        }
        if (organization.status !== 'active') {
          throw new Error('This workspace has been suspended. Contact your account administrator.');
        }
        const endsAt = typeof current.endsAt === 'string' ? current.endsAt : null;
        const status = String(current.status);
        const validEndDate = endsAt !== null && new Date(endsAt).getTime() > Date.now();
        const active = ['active', 'trial'].includes(status) && validEndDate;
        const expired = ['expired', 'cancelled', 'pending'].includes(status) || (['active', 'trial'].includes(status) && !validEndDate);
        if (!active && !expired) {
          window.location.assign('/dashboard');
          return;
        }
        const activation = data && 'activationRequest' in data ? data.activationRequest : null;
        setAccess({
          organizationName: organization.name,
          subscription: {
            planCode: typeof current.planCode === 'string' ? current.planCode : null,
            status: expired ? 'expired' : status,
            startsAt: typeof current.startsAt === 'string' ? current.startsAt : null,
            endsAt,
            provider: typeof current.provider === 'string' ? current.provider : null,
          },
          plans: Array.isArray(data.plans) ? data.plans.filter((plan): plan is RenewalPlan =>
            isRecord(plan) && typeof plan.code === 'string' && typeof plan.name === 'string' &&
            typeof plan.monthlyPrice === 'number' && typeof plan.currency === 'string' &&
            (plan.billingInterval === 'monthly' || plan.billingInterval === 'yearly') &&
            Array.isArray(plan.features) && plan.features.every((feature) => typeof feature === 'string'),
          ) : [],
          activationRequest: isRecord(activation) && typeof activation.id === 'string' &&
            typeof activation.planCode === 'string' && typeof activation.requestedAt === 'string' &&
            (activation.requestType === 'trial' || activation.requestType === 'activation')
            ? activation as ActivationRequest : null,
          canManageBilling: data && data.canManageBilling === true,
          partnerPlansUrl: typeof data.partnerPlansUrl === 'string' && /^https:\/\//i.test(data.partnerPlansUrl) ? data.partnerPlansUrl : null,
          trialExpired: status === 'trial' && expired,
        });
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Could not verify workspace access.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void checkAccess();
    return () => controller.abort();
  }, [isUngatedRoute, refreshKey]);

  useEffect(() => {
    const subscription = access?.subscription;
    if (!subscription || !['active', 'trial'].includes(subscription.status) || !subscription.endsAt) return;
    const expiryTime = new Date(subscription.endsAt).getTime();
    if (!Number.isFinite(expiryTime)) return;
    const delay = Math.min(Math.max(50, expiryTime - Date.now() + 50), 2_147_000_000);
    const timer = window.setTimeout(() => {
      setLoading(true);
      setRefreshKey((value) => value + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [access]);

  if (isUngatedRoute) return children;

  if (loading) {
    return <main className="subscription-gate-message" role="status">Checking your workspace subscription…</main>;
  }
  if (error) {
    return <main className="subscription-gate-message" role="alert">
      <p>{error}</p>
      <button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Try again</button>
      <button className="subscription-back" type="button" onClick={() => void signOut()}>Sign out</button>
    </main>;
  }
  if (!access) return null;
  const isExpired = access.subscription.status === 'expired' || access.subscription.status === 'cancelled' || access.subscription.status === 'pending';
  return (
    <SubscriptionContext.Provider value={access}>
      {isExpired ? (
        <>
          <div className="workspace-expired-background" aria-hidden="true" inert>{children}</div>
          <ExpiredSubscriptionOverlay access={access} onRequest={(activationRequest) => setAccess((current) => current ? { ...current, activationRequest } : current)} />
        </>
      ) : children}
    </SubscriptionContext.Provider>
  );
}

function ExpiredSubscriptionOverlay({ access, onRequest }: { access: WorkspaceAccess; onRequest: (request: ActivationRequest) => void }) {
  const [busyPlan, setBusyPlan] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function requestRenewal(plan: RenewalPlan) {
    setBusyPlan(plan.code);
    setError('');
    setMessage('');
    try {
      const response = await crmApiFetch('/billing/request-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: plan.code }),
      });
      const payload: unknown = await response.json();
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      if (!response.ok || !data || typeof data.id !== 'string' || typeof data.planCode !== 'string' || typeof data.requestedAt !== 'string') {
        const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Could not request plan renewal.');
      }
      const request = { id: data.id, planCode: data.planCode, requestType: 'activation' as const, requestedAt: data.requestedAt };
      onRequest(request);
      setMessage('Renewal request sent. The platform team must verify payment and approve it before access is restored.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request plan renewal.');
    } finally {
      setBusyPlan('');
    }
  }

  return (
    <div className="workspace-expired-overlay" role="presentation">
      <section className="workspace-expired-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-expired-title">
        <p className="date-label">WORKSPACE SUBSCRIPTION</p>
        <h1 id="workspace-expired-title">{access.organizationName} is paused</h1>
        <p className="workspace-expired-copy">{access.subscription.status === 'pending' ? 'Your subscription is waiting for payment verification.' : access.trialExpired ? 'Your CRM trial has ended.' : 'Your subscription is inactive.'} {access.subscription.status === 'pending' ? 'Access will begin after your partner confirms the payment.' : 'Your organization must have an active plan to continue using your CRM.'} Your data remains private and retained.</p>
        {access.activationRequest && (
          <p className="workspace-renewal-status" role="status">A renewal request for {access.plans.find((plan) => plan.code === access.activationRequest?.planCode)?.name ?? access.activationRequest.planCode} is awaiting platform review.</p>
        )}
        {message && <p className="workspace-renewal-status" role="status">{message}</p>}
        {error && <p className="workspace-renewal-error" role="alert">{error}</p>}
        {!access.partnerPlansUrl && <div className="workspace-renewal-plans">
          {access.plans.map((plan) => (
            <article className="workspace-renewal-plan" key={plan.code}>
              <h2>{plan.name}</h2>
              <p><strong>{plan.currency} {plan.monthlyPrice.toLocaleString('en-IN')}</strong> / {plan.billingInterval === 'yearly' ? 'year' : 'month'}</p>
              <ul>{plan.features.slice(0, 3).map((feature) => <li key={feature}>{feature}</li>)}</ul>
              {access.canManageBilling ? (
                <button className="button button-primary" type="button" disabled={Boolean(busyPlan) || Boolean(access.activationRequest)} onClick={() => void requestRenewal(plan)}>
                  {busyPlan === plan.code ? 'Sending request…' : access.activationRequest ? 'Request pending' : 'Request renewal'}
                </button>
              ) : <p className="workspace-renewal-owner-note">Ask your workspace owner or administrator to renew.</p>}
            </article>
          ))}
        </div>}
        {access.partnerPlansUrl && <p className="workspace-renewal-status">Choose a plan on your subscription provider’s website. CRM access returns after payment is verified.</p>}
        {!access.partnerPlansUrl && !access.plans.length && <p className="workspace-renewal-status">No plans are available. Contact your platform administrator.</p>}
        <footer className="workspace-expired-actions">
          <button className="button button-secondary" type="button" onClick={() => window.location.reload()}>Check access</button>
          {access.partnerPlansUrl && <a className="button button-primary" href={access.partnerPlansUrl} target="_blank" rel="noopener noreferrer">View Plans / Renew</a>}
        </footer>
      </section>
    </div>
  );
}

export function SubscriptionExpiryBanner() {
  const access = useContext(SubscriptionContext);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!access?.subscription.endsAt || !['active', 'trial'].includes(access.subscription.status) || now === null) return null;
  const daysLeft = subscriptionDaysRemaining(access.subscription.endsAt, now);
  if (daysLeft === null || daysLeft < 1 || daysLeft > 10) return null;

  return (
    <div className={`subscription-expiry-banner${daysLeft <= 3 ? ' is-urgent' : ''}`} role="status" aria-live="polite">
      <strong>{daysLeft}</strong>
      <span>{daysLeft === 1 ? 'day left' : 'days left'} before plan expiry</span>
      <Link href="/subscription">Renew</Link>
    </div>
  );
}
