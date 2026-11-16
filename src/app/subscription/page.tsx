'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import CrmShell from '../components/CrmShell';

type BillingInfo = {
  organization: { name: string };
  subscription: { planCode: string | null; status: string; startsAt: string | null; endsAt: string | null; provider: string | null };
  plans: Array<{ code: string; name: string; monthlyPrice: number; currency: string; billingInterval: string; features: string[]; modules: string[]; seats: number }>;
  partnerPlansUrl: string | null;
  canManageBilling: boolean;
  payuEnabled: boolean;
  trialAmount: string;
};

export default function SubscriptionPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [error, setError] = useState('');
  const [featurePlanCode, setFeaturePlanCode] = useState('');
  const [checkoutPlanCode, setCheckoutPlanCode] = useState('');
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  useEffect(() => {
    let active = true;
    void crmApiFetch('/billing/current')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load subscription details.');
        if (active) { const info = payload.data as BillingInfo; setBilling(info); setFeaturePlanCode(info.subscription.planCode ?? info.plans[0]?.code ?? ''); setCheckoutPlanCode(info.subscription.planCode ?? info.plans[0]?.code ?? ''); }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load subscription details.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (billing && !billing.canManageBilling) router.replace('/');
  }, [billing, router]);

  if (billing && !billing.canManageBilling) return null;
  if (error) return <CrmShell active="Subscription"><main className="settings-route-content"><p role="alert">{error}</p></main></CrmShell>;
  if (!billing) return <CrmShell active="Subscription"><main className="settings-route-content" role="status">Loading subscription details…</main></CrmShell>;

  const subscription = billing.subscription;
  const status = subscription.status.toLowerCase();
  const currentPlan = billing.plans.find((plan) => plan.code === subscription.planCode);
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—';
  const money = (plan: BillingInfo['plans'][number]) => `${plan.currency} ${plan.monthlyPrice.toLocaleString('en-IN')} / ${plan.billingInterval === 'yearly' ? 'year' : 'month'}`;
  const providerName = subscription.provider === 'partner' ? 'Subscription partner' : subscription.provider === 'payu' ? 'PayU' : subscription.provider === 'trial' ? 'Trial access' : subscription.provider === 'manual' ? 'Platform administrator' : subscription.provider ?? 'Platform administrator';
  const canUsePayU = billing.canManageBilling && billing.payuEnabled && subscription.provider !== 'partner';
  const checkoutPlan = billing.plans.find((plan) => plan.code === checkoutPlanCode) ?? currentPlan ?? billing.plans[0];
  const renewalWindowOpen = Boolean(subscription.endsAt && new Date(subscription.endsAt).getTime() > Date.now() && new Date(subscription.endsAt).getTime() <= Date.now() + 10 * 24 * 60 * 60 * 1000);
  const periodStart = subscription.startsAt ? new Date(subscription.startsAt).getTime() : null;
  const periodEnd = subscription.endsAt ? new Date(subscription.endsAt).getTime() : null;
  const periodProgress = periodStart && periodEnd && periodEnd > periodStart
    ? Math.max(0, Math.min(100, ((Date.now() - periodStart) / (periodEnd - periodStart)) * 100))
    : 0;
  const periodDaysRemaining = periodEnd ? Math.max(0, Math.ceil((periodEnd - Date.now()) / 86_400_000)) : null;

  async function beginCheckout(planCode: string, purchaseType: 'trial' | 'plan' | 'renewal') {
    setCheckoutError('');
    if (!checkoutPhone.trim()) { setCheckoutError('Enter a phone number for PayU checkout.'); return; }
    setCheckoutBusy(true);
    try {
      const response = await crmApiFetch('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, purchaseType, phone: checkoutPhone.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not start PayU checkout.');
      const result = payload?.data as { checkoutUrl?: unknown; fields?: unknown } | undefined;
      if (typeof result?.checkoutUrl !== 'string' || typeof result.fields !== 'object' || result.fields === null) throw new Error('PayU returned an invalid checkout response.');
      const action = new URL(result.checkoutUrl);
      if (action.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(action.hostname)) throw new Error('The PayU checkout URL must use HTTPS.');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = action.toString();
      for (const [name, value] of Object.entries(result.fields)) {
        if (typeof value !== 'string') continue;
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = name; input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (caught) {
      setCheckoutError(caught instanceof Error ? caught.message : 'Could not start PayU checkout.');
      setCheckoutBusy(false);
    }
  }

  return (
    <CrmShell active="Subscription"><main className="settings-route-content subscription-page-content">
      <section className="panel subscription-summary-panel" aria-labelledby="subscription-heading">
        <div className="subscription-status-overview">
        <div className="billing-section-heading">
          <div><span className="auth-step">WORKSPACE BILLING</span><h2 id="subscription-heading">{currentPlan?.name ?? subscription.planCode ?? 'Subscription'}</h2></div>
          <strong className="status-pill">{status}</strong>
        </div>
        {status === 'trial' ? <p>Trial expires {date(subscription.endsAt)}.</p> : <p>{status === 'active' ? 'Current plan' : 'Plan period'}: {date(subscription.startsAt)} – {date(subscription.endsAt)}</p>}
        <p>Billing managed by: {providerName}</p>
        {periodEnd && <div className="subscription-period-card"><div><span>PLAN PERIOD</span><strong>{periodDaysRemaining === null ? '—' : `${periodDaysRemaining} days remaining`}</strong></div><div className="subscription-period-track"><i style={{ width: `${periodProgress}%` }} /></div><small>{status === 'trial' ? 'Trial access' : 'Current subscription'} · Ends {date(subscription.endsAt)}</small></div>}
        {status === 'active' && billing.canManageBilling && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Renew current plan</a>}
        {status === 'trial' && billing.canManageBilling && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Pay now or upgrade plan</a>}
        {!billing.partnerPlansUrl && !canUsePayU && <p>Contact your platform administrator to renew or change this workspace plan.</p>}
        </div>
        {canUsePayU && status === 'trial' && checkoutPlan && <div className="subscription-checkout-box">
          <p>Your trial is active. Pay for the current plan now or choose another plan to upgrade immediately.</p>
          <label>Pay or upgrade to<select value={checkoutPlanCode} onChange={(event) => setCheckoutPlanCode(event.target.value)}>{billing.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {money(plan)}</option>)}</select></label>
          <label>Phone number for PayU<input type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label>
          <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => void beginCheckout(checkoutPlan.code, 'plan')}>{checkoutBusy ? 'Opening PayU…' : checkoutPlan.code === subscription.planCode ? 'Pay now' : `Upgrade to ${checkoutPlan.name}`}</button>
          {checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}
        </div>}
        {canUsePayU && status === 'active' && renewalWindowOpen && currentPlan && <div className="subscription-checkout-box"><p>Your renewal window is open. Continue to PayU to renew this plan.</p><label>Phone number for PayU<input type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label><button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => void beginCheckout(currentPlan.code, 'renewal')}>{checkoutBusy ? 'Opening PayU…' : 'Pay now to renew'}</button>{checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}</div>}
      </section>

      <section className="subscription-feature-center" aria-labelledby="subscription-feature-heading">
        <header className="subscription-feature-header"><div><span className="auth-step">PLAN FEATURE CENTER</span><h2 id="subscription-feature-heading">Explore what each plan unlocks</h2><p>Compare workspace tools, team size, and included modules before choosing an upgrade.</p></div><span className="subscription-feature-orbit" aria-hidden="true" /></header>
        <div className="subscription-feature-tabs" role="tablist" aria-label="Choose a plan to explore">{billing.plans.map((plan) => <button key={plan.code} type="button" role="tab" aria-selected={featurePlanCode === plan.code} className={featurePlanCode === plan.code ? 'is-selected' : ''} onClick={() => setFeaturePlanCode(plan.code)}>{plan.name}{plan.code === subscription.planCode ? ' · Current' : ''}</button>)}</div>
        {billing.plans.filter((plan) => plan.code === featurePlanCode).map((plan) => <article className="subscription-feature-card" key={plan.code}>
          <div className="subscription-feature-card-aura" aria-hidden="true" /><div className="subscription-feature-card-top"><span>{plan.name} workspace plan</span><span className="subscription-feature-price">{money(plan)}</span></div>
          <div className="subscription-feature-card-main"><div><h3>{plan.code === subscription.planCode ? 'Your current toolkit' : `Unlock ${plan.name}`}</h3><p>Built for teams of {plan.seats > 0 ? `up to ${plan.seats}` : 'unlimited'} members.</p><div className="subscription-feature-pills">{plan.modules.map((module) => <span key={module}>{module.replaceAll('-', ' ')}</span>)}</div></div><div className="subscription-feature-benefits"><span>Included capabilities</span>{(plan.features.length ? plan.features : plan.modules.map((module) => module.replaceAll('-', ' '))).map((feature) => <p key={feature}><b>✦</b>{feature}</p>)}</div></div>
          {canUsePayU && status === 'trial' && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => { setCheckoutPlanCode(plan.code); void beginCheckout(plan.code, 'plan'); }}>{checkoutBusy ? 'Opening PayU…' : plan.code === subscription.planCode ? 'Pay now' : `Upgrade to ${plan.name}`}</button>}
          {canUsePayU && ['pending', 'expired', 'cancelled'].includes(status) && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => { setCheckoutPlanCode(plan.code); void beginCheckout(plan.code, status === 'pending' ? 'trial' : 'plan'); }}>{checkoutBusy ? 'Opening PayU…' : status === 'pending' ? `Start ₹${billing.trialAmount} trial` : `Choose ${plan.name}`}</button>}
          {canUsePayU && status === 'active' && renewalWindowOpen && plan.code === subscription.planCode && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => void beginCheckout(plan.code, 'renewal')}>{checkoutBusy ? 'Opening PayU…' : 'Renew plan'}</button>}
          {plan.code !== subscription.planCode && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Explore this plan</a>}
        </article>)}
        {!billing.plans.length && <p>No plan features are available right now.</p>}
      </section>

      <section className="workspace-renewal-plans" aria-label="Available subscription plans">
        {canUsePayU && ['pending', 'expired', 'cancelled'].includes(status) && <div className="subscription-checkout-box subscription-checkout-plans-box"><p>{status === 'pending' ? `Pay ₹${billing.trialAmount} to start the two-day trial.` : 'Choose a plan to restore workspace access.'}</p><label>Phone number for PayU<input type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label>{checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}</div>}
        {billing.plans.map((plan) => {
          const isCurrent = plan.code === subscription.planCode;
          return <article className="workspace-renewal-plan" key={plan.code}>
            <h2>{plan.name}{isCurrent ? ' · Current plan' : ''}</h2>
            <p><strong>{money(plan)}</strong></p>
            <p>{plan.seats > 0 ? `Up to ${plan.seats} workspace members` : 'Unlimited workspace members'}</p>
            {billing.canManageBilling && billing.partnerPlansUrl && (isCurrent && status === 'trial' || !isCurrent) && <a className="button button-secondary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">{isCurrent ? 'Choose this plan' : status === 'active' ? 'Upgrade options' : 'Choose plan'}</a>}
            {!isCurrent && !billing.partnerPlansUrl && <p>Contact your platform administrator to change plans.</p>}
          </article>;
        })}
        {!billing.plans.length && <p>No other plans are currently available.</p>}
      </section>

      {currentPlan?.modules.includes('billing-invoicing') && <section className="settings-route-grid" aria-label="Billing tools"><Link className="settings-route-card" href="/billing-invoicing"><h2>Billing &amp; Invoicing</h2><p>Create and manage customer invoices, quotations, payments, receipts, products, and billing settings.</p><span>Open billing &amp; invoicing →</span></Link></section>}
    </main></CrmShell>
  );
}
