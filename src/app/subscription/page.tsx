'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Plan = {
  code: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  seats: number;
  features: string[];
};

type BillingData = {
  organization: { id: string; name: string; status: string };
  subscription: { planCode: string | null; status: string; startsAt: string | null; endsAt: string | null; provider: string | null };
  plans: Plan[];
  testMode: boolean;
  canManageBilling: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlan(value: unknown): value is Plan {
  return isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.name === 'string' &&
    typeof value.monthlyPrice === 'number' &&
    typeof value.currency === 'string' &&
    typeof value.seats === 'number' &&
    Array.isArray(value.features) &&
    value.features.every((feature) => typeof feature === 'string');
}

function isBillingData(value: unknown): value is BillingData {
  if (!isRecord(value) || !isRecord(value.organization) || !isRecord(value.subscription)) return false;
  return typeof value.organization.name === 'string' &&
    typeof value.subscription.status === 'string' &&
    Array.isArray(value.plans) && value.plans.every(isPlan) &&
    typeof value.testMode === 'boolean' &&
    typeof value.canManageBilling === 'boolean';
}

export default function SubscriptionPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function loadBilling() {
      try {
        const response = await crmApiFetch('/billing/current', { signal: controller.signal });
        const payload: unknown = await response.json();
        if (response.status === 401) {
          window.location.assign('/sign-in');
          return;
        }
        if (!response.ok) {
          const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
          throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Could not load subscription plans.');
        }
        const data = isRecord(payload) ? payload.data : null;
        if (!isBillingData(data)) throw new Error('The billing API returned an invalid response.');
        setBilling(data);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Could not load subscription plans.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadBilling();
    return () => controller.abort();
  }, []);

  async function startPlan(plan: Plan) {
    setBusyPlan(plan.code);
    setError('');
    try {
      const response = await crmApiFetch('/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: plan.code }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Could not start the subscription.');
      }
      window.location.assign('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the subscription.');
    } finally {
      setBusyPlan('');
    }
  }

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

  const currentPlan = billing?.plans.find((plan) => plan.code === billing.subscription.planCode);
  const canStartTestPlan = billing?.testMode && billing.subscription.status === 'pending' && billing.canManageBilling;

  return (
    <main className="subscription-page">
      <header className="subscription-header">
        <Link className="brand" href="/">
          <span className="brand-mark">m</span>
          <span>myr<span className="brand-light">crm</span></span>
        </Link>
        {billing?.subscription.status === 'active' || billing?.subscription.status === 'trial'
          ? <Link className="subscription-back" href="/">Back to CRM</Link>
          : <button className="subscription-back" type="button" onClick={() => void signOut()}>Sign out</button>}
      </header>

      <section className="subscription-content">
        <p className="date-label">WORKSPACE SUBSCRIPTION</p>
        <h1>{billing?.organization.name ? `Plans for ${billing.organization.name}` : 'Choose your CRM plan'}</h1>
        <p className="subscription-intro">Select a plan to activate workspace access. Each plan is billed monthly once online checkout is configured.</p>

        {loading && <p className="subscription-state" role="status">Loading subscription plans…</p>}
        {error && <div className="control-panel-error" role="alert">{error}</div>}
        {billing && billing.subscription.status !== 'pending' && (
          <div className="subscription-state" role="status">
            {currentPlan
              ? <><strong>{currentPlan.name}</strong> · {billing.subscription.status} subscription{billing.subscription.endsAt ? ` · ends ${new Date(billing.subscription.endsAt).toLocaleDateString()}` : ''}</>
              : `Subscription status: ${billing.subscription.status}`}
          </div>
        )}

        {billing && (
          <>
            <div className="subscription-plans">
              {billing.plans.map((plan) => (
                <article className={`subscription-plan${plan.code === 'growth' ? ' recommended' : ''}`} key={plan.code}>
                  {plan.code === 'growth' && <span className="subscription-recommended">POPULAR</span>}
                  <h2>{plan.name}</h2>
                  <p className="subscription-price">₹{plan.monthlyPrice.toLocaleString('en-IN')}<small> / month</small></p>
                  <p className="subscription-seats">Up to {plan.seats} team members</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  {canStartTestPlan ? (
                    <button className="button button-primary subscription-button" type="button" disabled={Boolean(busyPlan)} onClick={() => void startPlan(plan)}>
                      {busyPlan === plan.code ? 'Starting trial…' : 'Start 2-day test trial'}
                    </button>
                  ) : <button className="button button-secondary subscription-button" type="button" disabled>
                    {billing.subscription.status === 'pending' && !billing.canManageBilling ? 'Ask your workspace owner' : billing.testMode ? 'Trial already used' : 'Checkout coming soon'}
                  </button>}
                </article>
              ))}
            </div>
            <p className="subscription-disclaimer">
              {billing.testMode
                ? 'TEST MODE: Starting a plan activates a 2-day trial only. No payment is collected. Razorpay checkout will be enabled after payment credentials are configured.'
                : 'Online checkout is not configured yet. Contact the platform team to activate your subscription.'}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
