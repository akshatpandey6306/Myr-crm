'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Plan = {
  code: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  billingInterval: 'monthly' | 'yearly';
  trialDays: number;
  seats: number;
  features: string[];
};

type BillingData = {
  organization: { id: string; name: string; status: string };
  subscription: { planCode: string | null; status: string; startsAt: string | null; endsAt: string | null; provider: string | null };
  activationRequest: { id: string; planCode: string; requestedAt: string } | null;
  plans: Plan[];
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
    (value.billingInterval === 'monthly' || value.billingInterval === 'yearly') &&
    typeof value.trialDays === 'number' &&
    typeof value.seats === 'number' &&
    Array.isArray(value.features) &&
    value.features.every((feature) => typeof feature === 'string');
}

function isBillingData(value: unknown): value is BillingData {
  if (!isRecord(value) || !isRecord(value.organization) || !isRecord(value.subscription)) return false;
  const activationRequest = value.activationRequest;
  return typeof value.organization.name === 'string' &&
    typeof value.subscription.status === 'string' &&
    (activationRequest === null || (
      isRecord(activationRequest) &&
      typeof activationRequest.id === 'string' &&
      typeof activationRequest.planCode === 'string' &&
      typeof activationRequest.requestedAt === 'string'
    )) &&
    Array.isArray(value.plans) && value.plans.every(isPlan) &&
    typeof value.canManageBilling === 'boolean';
}

export default function SubscriptionPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState('');
  const [error, setError] = useState('');
  const [requestMessage, setRequestMessage] = useState('');

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

  async function requestActivation(plan: Plan) {
    setBusyPlan(plan.code);
    setError('');
    setRequestMessage('');
    try {
      const response = await crmApiFetch('/billing/request-activation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: plan.code }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
        throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Could not request plan activation.');
      }
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      if (!data || typeof data.id !== 'string' || typeof data.planCode !== 'string' || typeof data.requestedAt !== 'string') {
        throw new Error('The activation request response was invalid.');
      }
      const activationRequest = { id: data.id, planCode: data.planCode, requestedAt: data.requestedAt };
      setBilling((current) => current ? {
        ...current,
        activationRequest,
      } : current);
      setRequestMessage('Your activation request was sent to the platform team. They will review it and activate your selected plan manually.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request plan activation.');
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
  const canStartTrial = billing?.subscription.status === 'pending' && billing.canManageBilling;
  const canRequestActivation = billing?.canManageBilling &&
    ['expired', 'cancelled'].includes(billing.subscription.status) &&
    !billing.activationRequest;

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
        <p className="subscription-intro">Select a plan to activate workspace access. Prices use each plan’s configured billing interval.</p>

        {loading && <p className="subscription-state" role="status">Loading subscription plans…</p>}
        {error && <div className="control-panel-error" role="alert">{error}</div>}
        {requestMessage && <div className="subscription-state" role="status">{requestMessage}</div>}
        {billing?.activationRequest && (
          <div className="subscription-state" role="status">
            Plan activation requested for {billing.plans.find((plan) => plan.code === billing.activationRequest?.planCode)?.name ?? billing.activationRequest.planCode}
            {' '}on {new Date(billing.activationRequest.requestedAt).toLocaleDateString()}. The platform team will review your request.
          </div>
        )}
        {billing && billing.subscription.status !== 'pending' && (
          <div className="subscription-state" role="status">
            {currentPlan
              ? <><strong>{currentPlan.name}</strong> · {billing.subscription.status} subscription{billing.subscription.endsAt ? ` · ends ${new Date(billing.subscription.endsAt).toLocaleDateString()}` : ''}</>
              : `Subscription status: ${billing.subscription.status}`}
          </div>
        )}
        {billing?.subscription.status === 'expired' && (
          <div className="subscription-state" role="status">
            Your workspace subscription has expired. Review the plan rates below and contact the platform team to arrange activation.
          </div>
        )}

        {billing && (
          <>
            <div className="subscription-plans">
              {billing.plans.map((plan) => (
                <article className={`subscription-plan${plan.code === 'growth' ? ' recommended' : ''}`} key={plan.code}>
                  {plan.code === 'growth' && <span className="subscription-recommended">POPULAR</span>}
                  <h2>{plan.name}</h2>
                  <p className="subscription-price">{plan.currency} {plan.monthlyPrice.toLocaleString('en-IN')}<small> / {plan.billingInterval === 'yearly' ? 'year' : 'month'}</small></p>
                  <p className="subscription-seats">{plan.seats ? `Up to ${plan.seats} team members` : 'Unlimited team members'}</p>
                  <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                  {canStartTrial ? (
                    <button className="button button-primary subscription-button" type="button" disabled={Boolean(busyPlan)} onClick={() => void startPlan(plan)}>
                      {busyPlan === plan.code ? 'Starting trial…' : 'Start 2-day free trial'}
                    </button>
                  ) : canRequestActivation ? (
                    <button className="button button-primary subscription-button" type="button" disabled={Boolean(busyPlan)} onClick={() => void requestActivation(plan)}>
                      {busyPlan === plan.code ? 'Sending request…' : `Buy ${plan.name} · request activation`}
                    </button>
                  ) : <button className="button button-secondary subscription-button" type="button" disabled>
                    {billing.subscription.status === 'pending' && !billing.canManageBilling
                      ? 'Ask your workspace owner'
                      : billing.activationRequest
                        ? 'Activation requested'
                      : billing.subscription.status === 'expired'
                        ? `Manual activation · ${plan.currency} ${plan.monthlyPrice.toLocaleString('en-IN')} / ${plan.billingInterval === 'yearly' ? 'year' : 'month'}`
                        : billing.subscription.status === 'trial' || billing.subscription.status === 'active'
                          ? 'Included in your current plan'
                          : 'Request activation below'}
                  </button>}
                </article>
              ))}
            </div>
            {['pending', 'expired'].includes(billing.subscription.status) && (
              <aside className="subscription-payu-notice" aria-label="PayU payment status">
                <span className="subscription-payu-wordmark">PayU</span>
                <div>
                  <strong>Online payments are not configured yet</strong>
                  <p>
                    {billing.subscription.status === 'expired'
                      ? 'Your free trial has ended. Request plan activation and the platform team will contact you.'
                      : 'Start a free two-day trial; no payment is collected. Online checkout is not configured yet.'}
                  </p>
                </div>
              </aside>
            )}
            <p className="subscription-disclaimer">
              {'Starting a plan activates a free two-day trial. No payment is collected; online checkout is not configured yet.'}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
