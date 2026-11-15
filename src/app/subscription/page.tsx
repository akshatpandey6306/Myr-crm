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
};

export default function SubscriptionPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [error, setError] = useState('');
  const [featurePlanCode, setFeaturePlanCode] = useState('');

  useEffect(() => {
    let active = true;
    void crmApiFetch('/billing/current')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load subscription details.');
        if (active) { const info = payload.data as BillingInfo; setBilling(info); setFeaturePlanCode(info.subscription.planCode ?? info.plans[0]?.code ?? ''); }
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

  return (
    <CrmShell active="Subscription"><main className="settings-route-content">
      <p className="welcome-copy">Subscription and billing status for {billing.organization.name}.</p>
      <section className="panel" aria-labelledby="subscription-heading">
        <div className="billing-section-heading">
          <div><span className="auth-step">WORKSPACE BILLING</span><h2 id="subscription-heading">{currentPlan?.name ?? subscription.planCode ?? 'Subscription'}</h2></div>
          <strong className="status-pill">{status}</strong>
        </div>
        {status === 'trial' ? <p>Trial expires {date(subscription.endsAt)}.</p> : <p>{status === 'active' ? 'Current plan' : 'Plan period'}: {date(subscription.startsAt)} – {date(subscription.endsAt)}</p>}
        <p>Billing managed by: {providerName}</p>
        {status === 'active' && billing.canManageBilling && billing.partnerPlansUrl && <p><a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Renew current plan</a></p>}
        {!billing.partnerPlansUrl && <p>Contact your platform administrator to renew or change this workspace plan.</p>}
      </section>

      <section className="subscription-feature-center" aria-labelledby="subscription-feature-heading">
        <header className="subscription-feature-header"><div><span className="auth-step">PLAN FEATURE CENTER</span><h2 id="subscription-feature-heading">Explore what each plan unlocks</h2><p>Compare workspace tools, team size, and included modules before choosing an upgrade.</p></div><span className="subscription-feature-orbit" aria-hidden="true" /></header>
        <div className="subscription-feature-tabs" role="tablist" aria-label="Choose a plan to explore">{billing.plans.map((plan) => <button key={plan.code} type="button" role="tab" aria-selected={featurePlanCode === plan.code} className={featurePlanCode === plan.code ? 'is-selected' : ''} onClick={() => setFeaturePlanCode(plan.code)}>{plan.name}{plan.code === subscription.planCode ? ' · Current' : ''}</button>)}</div>
        {billing.plans.filter((plan) => plan.code === featurePlanCode).map((plan) => <article className="subscription-feature-card" key={plan.code}>
          <div className="subscription-feature-card-aura" aria-hidden="true" /><div className="subscription-feature-card-top"><span>{plan.name} workspace plan</span><span className="subscription-feature-price">{money(plan)}</span></div>
          <div className="subscription-feature-card-main"><div><h3>{plan.code === subscription.planCode ? 'Your current toolkit' : `Unlock ${plan.name}`}</h3><p>Built for teams of {plan.seats > 0 ? `up to ${plan.seats}` : 'unlimited'} members.</p><div className="subscription-feature-pills">{plan.modules.map((module) => <span key={module}>{module.replaceAll('-', ' ')}</span>)}</div></div><div className="subscription-feature-benefits"><span>Included capabilities</span>{(plan.features.length ? plan.features : plan.modules.map((module) => module.replaceAll('-', ' '))).map((feature) => <p key={feature}><b>✦</b>{feature}</p>)}</div></div>
          {plan.code !== subscription.planCode && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Explore this plan</a>}
        </article>)}
        {!billing.plans.length && <p>No plan features are available right now.</p>}
      </section>

      <section className="workspace-renewal-plans" aria-label="Available subscription plans">
        {billing.plans.map((plan) => {
          const isCurrent = plan.code === subscription.planCode;
          return <article className="workspace-renewal-plan" key={plan.code}>
            <h2>{plan.name}{isCurrent ? ' · Current plan' : ''}</h2>
            <p><strong>{money(plan)}</strong></p>
            <p>{plan.seats > 0 ? `Up to ${plan.seats} workspace members` : 'Unlimited workspace members'}</p>
            {plan.features.length > 0 && <ul>{plan.features.slice(0, 4).map((feature) => <li key={feature}>{feature}</li>)}</ul>}
            {plan.modules.length > 0 && <p>Includes {plan.modules.map((module) => module.replaceAll('-', ' ')).join(', ')}</p>}
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
