'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { billingIntervalLabel } from '../../lib/billing-interval';
import CrmShell from '../components/CrmShell';

type BillingInfo = {
  organization: { name: string };
  subscription: { planCode: string | null; status: string; startsAt: string | null; endsAt: string | null; provider: string | null };
  plans: Array<{ code: string; name: string; monthlyPrice: number; currency: string; billingInterval: number; features: string[]; modules: string[]; seats: number; additionalSeatsEnabled: boolean; additionalSeatPrice: number }>;
  seats: { included: number; additional: number; activeUsers: number; pendingUsers: number; purchases: Array<{ quantity: number; unitPrice: number; billingInterval: number; currency: string; status: string; purchasedAt: string; endsAt: string }> };
  partnerPlansUrl: string | null;
  canManageBilling: boolean;
  payuEnabled: boolean;
};

type SubscriptionPayment = {
  id: string;
  planCode: string;
  paymentType: string;
  seatQuantity: number | null;
  transactionId: string;
  amount: string;
  currency: string;
  status: string;
  payuId: string | null;
  bankReference: string | null;
  failureReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export default function SubscriptionPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [error, setError] = useState('');
  const [featurePlanCode, setFeaturePlanCode] = useState('');
  const [detailsPlanCode, setDetailsPlanCode] = useState('');
  const [checkoutPlanCode, setCheckoutPlanCode] = useState('');
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [additionalSeatQuantity, setAdditionalSeatQuantity] = useState('1');
  const [checkoutBusyPlanCode, setCheckoutBusyPlanCode] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [paymentResult, setPaymentResult] = useState('');
  const [paymentTransaction, setPaymentTransaction] = useState('');
  const [paymentChecking, setPaymentChecking] = useState(false);
  const [purchasedPlanCode, setPurchasedPlanCode] = useState('');
  const [purchasedPaymentType, setPurchasedPaymentType] = useState('');
  const [purchasedSeatQuantity, setPurchasedSeatQuantity] = useState(0);
  const [paymentRetry, setPaymentRetry] = useState(0);
  const [paymentHistory, setPaymentHistory] = useState<SubscriptionPayment[]>([]);
  const [paymentHistoryError, setPaymentHistoryError] = useState('');

  const recheckPayment = useCallback(async (transactionId: string) => {
    setPaymentTransaction(transactionId);
    setPaymentChecking(true);
    setCheckoutError('');
    try {
      const response = await crmApiFetch(`/billing/payment-status/${encodeURIComponent(transactionId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not check payment status.');
      const payment = payload?.data as { status?: string; planCode?: string; paymentType?: string; seatQuantity?: number | null; amount?: string; failureReason?: string | null } | undefined;
      if (!payment?.status) throw new Error('The API returned no payment status.');
      const status = payment.status === 'succeeded' ? 'success' : payment.status;
      setPaymentResult(status);
      setPurchasedPlanCode(payment.planCode ?? '');
      setPurchasedPaymentType(payment.paymentType ?? '');
      setPurchasedSeatQuantity(payment.seatQuantity ?? 0);
      setPaymentHistory((previous) => previous.map((item) => item.transactionId === transactionId
        ? { ...item, status: status === 'success' ? 'succeeded' : status, failureReason: payment.failureReason ?? null, verifiedAt: status === 'success' ? new Date().toISOString() : item.verifiedAt }
        : item));
      if (status === 'success') {
        const currentResponse = await crmApiFetch('/billing/current');
        const currentPayload = await currentResponse.json();
        if (currentResponse.ok) {
          const info = currentPayload.data as BillingInfo;
          setBilling(info);
          setCheckoutPlanCode(info.subscription.planCode ?? info.plans[0]?.code ?? '');
          setFeaturePlanCode(info.subscription.planCode ?? info.plans[0]?.code ?? '');
          // Refresh the workspace gate and module-access context after PayU
          // confirms activation, so sidebar and API-backed module controls use
          // the newly purchased plan immediately.
          window.dispatchEvent(new Event('myr:organization-changed'));
        }
      }
    } catch (caught) {
      setCheckoutError(caught instanceof Error ? caught.message : 'Could not check payment status.');
    } finally {
      setPaymentChecking(false);
    }
  }, []);

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
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment');
    const transactionId = params.get('transaction') ?? '';
    if (!outcome) return;
    setPaymentTransaction(transactionId);
    if (!transactionId) {
      setPaymentResult('failed');
      setCheckoutError('The payment reference is missing. Check your subscription status or contact support.');
      return;
    }
    setPaymentResult('pending');

    void recheckPayment(transactionId);
  }, [paymentRetry, recheckPayment]);

  useEffect(() => {
    let active = true;
    void crmApiFetch('/billing/payments')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not load subscription payment history.');
        if (active) setPaymentHistory(Array.isArray(payload?.data) ? payload.data as SubscriptionPayment[] : []);
      })
      .catch((caught: unknown) => {
        if (active) setPaymentHistoryError(caught instanceof Error ? caught.message : 'Could not load subscription payment history.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (billing && !billing.canManageBilling) router.replace('/');
  }, [billing, router]);

  useEffect(() => {
    if (!detailsPlanCode) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setDetailsPlanCode('');
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [detailsPlanCode]);

  if (billing && !billing.canManageBilling) return null;
  if (error) return <CrmShell active="Subscription"><main className="settings-route-content"><p role="alert">{error}</p></main></CrmShell>;
  if (!billing) return <CrmShell active="Subscription"><main className="settings-route-content" role="status">Loading subscription details…</main></CrmShell>;

  const subscription = billing.subscription;
  const status = subscription.status.toLowerCase();
  const currentPlan = billing.plans.find((plan) => plan.code === subscription.planCode);
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString() : '—';
  const money = (plan: BillingInfo['plans'][number]) => `${plan.currency} ${plan.monthlyPrice.toLocaleString('en-IN')} / ${billingIntervalLabel(plan.billingInterval)}`;
  const providerName = subscription.provider === 'partner' ? 'Subscription partner' : subscription.provider === 'payu' ? 'PayU' : subscription.provider === 'manual' ? 'Platform administrator' : subscription.provider ?? 'Platform administrator';
  const canUsePayU = billing.canManageBilling && billing.payuEnabled && subscription.provider !== 'partner';
  const checkoutBusy = Boolean(checkoutBusyPlanCode);
  const checkoutPlan = billing.plans.find((plan) => plan.code === checkoutPlanCode) ?? currentPlan ?? billing.plans[0];
  const detailsPlan = billing.plans.find((plan) => plan.code === detailsPlanCode) ?? null;
  const periodStart = subscription.startsAt ? new Date(subscription.startsAt).getTime() : null;
  const periodEnd = subscription.endsAt ? new Date(subscription.endsAt).getTime() : null;
  const periodProgress = periodStart && periodEnd && periodEnd > periodStart
    ? Math.max(0, Math.min(100, ((Date.now() - periodStart) / (periodEnd - periodStart)) * 100))
    : 0;
  const periodDaysRemaining = periodEnd ? Math.max(0, Math.ceil((periodEnd - Date.now()) / 86_400_000)) : null;

  async function beginCheckout(planCode: string, purchaseType: 'plan' | 'renewal' | 'seats', seatQuantity?: number) {
    setCheckoutError('');
    if (!checkoutPhone.trim()) { setCheckoutError('Enter a phone number for PayU checkout.'); return; }
    setCheckoutBusyPlanCode(planCode);
    try {
      const response = await crmApiFetch('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, purchaseType, phone: checkoutPhone.trim(), ...(seatQuantity ? { seatQuantity } : {}) }),
      });
      const responseText = await response.text();
      let payload: { error?: { message?: unknown }; data?: unknown } | null = null;
      try { payload = JSON.parse(responseText) as { error?: { message?: unknown }; data?: unknown }; } catch { /* Preserve a readable API error below. */ }
      if (!response.ok) {
        const apiMessage = payload?.error?.message;
        const plainTextMessage = responseText.trim().startsWith('<') ? '' : responseText.trim().slice(0, 180);
        throw new Error(typeof apiMessage === 'string' ? apiMessage : plainTextMessage || `Could not start PayU checkout (HTTP ${response.status}).`);
      }
      if (!payload) throw new Error('The API returned an invalid checkout response.');
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
      setCheckoutBusyPlanCode('');
    }
  }

  function startPlanCheckout(planCode: string, purchaseType: 'plan' | 'renewal') {
    setCheckoutPlanCode(planCode);
    if (!checkoutPhone.trim()) {
      setCheckoutError('Enter your phone number for PayU, then continue to checkout.');
      document.getElementById('subscription-checkout-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById('subscription-checkout-phone')?.focus({ preventScroll: true });
      return;
    }
    void beginCheckout(planCode, purchaseType);
  }

  return (
    <CrmShell active="Subscription"><main className="settings-route-content subscription-page-content">
      {paymentResult && <section className={`subscription-payment-result subscription-payment-${paymentResult}`} role={paymentResult === 'failed' ? 'alert' : 'status'}>
        <div><strong>{paymentResult === 'success' ? 'Payment verified' : paymentResult === 'failed' ? 'Payment was not completed' : paymentResult === 'review' ? 'Payment verified; activation needs review' : 'Payment verification is pending'}</strong>
          <p>{paymentResult === 'success' ? purchasedPaymentType === 'seat_addon' ? `${purchasedSeatQuantity} additional workspace seats are now active.` : `Your ${billing?.plans.find((plan) => plan.code === (purchasedPlanCode || billing.subscription.planCode))?.name ?? 'subscription'} plan is active. Your workspace is ready.` : paymentResult === 'failed' ? 'PayU did not confirm this payment. You can return to the plans and try again.' : paymentResult === 'review' ? 'The payment was confirmed, but the workspace plan needs administrator review. Your payment has not been discarded.' : 'We are checking the payment directly with PayU. Access will update only after confirmation.'}</p>
        </div>
        {checkoutError && <p role="alert">{checkoutError}</p>}
        {paymentResult === 'pending' && paymentTransaction && <button type="button" className="button button-secondary" disabled={paymentChecking} onClick={() => { setCheckoutError(''); setPaymentRetry((retry) => retry + 1); }}>{paymentChecking ? 'Checking…' : 'Check payment status'}</button>}
      </section>}
      <section className="panel subscription-summary-panel" aria-labelledby="subscription-heading">
        <div className="subscription-status-overview">
        <div className="billing-section-heading">
          <div><span className="auth-step">WORKSPACE BILLING</span><h2 id="subscription-heading">{currentPlan?.name ?? subscription.planCode ?? 'Subscription'}</h2></div>
          <strong className="status-pill">{status}</strong>
        </div>
        <p>{status === 'active' ? 'Current plan' : 'Plan period'}: {date(subscription.startsAt)} – {date(subscription.endsAt)}</p>
        <p>Billing managed by: {providerName}</p>
        {periodEnd && <div className="subscription-period-card"><div><span>PLAN PERIOD</span><strong>{periodDaysRemaining === null ? '—' : `${periodDaysRemaining} days remaining`}</strong></div><div className="subscription-period-track"><i style={{ width: `${periodProgress}%` }} /></div><small>Current subscription · Ends {date(subscription.endsAt)}</small></div>}
        {status === 'active' && billing.canManageBilling && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Renew current plan</a>}
        {!billing.partnerPlansUrl && !canUsePayU && <p>Contact your platform administrator to renew or change this workspace plan.</p>}
        </div>
        {canUsePayU && status === 'active' && checkoutPlan && <div className="subscription-checkout-box" id="subscription-checkout-box">
          <p>Choose an upgrade or renew your current plan now. Early renewals extend from the current plan end date.</p>
          <label>Pay or upgrade to<select value={checkoutPlanCode} onChange={(event) => setCheckoutPlanCode(event.target.value)}>{billing.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {money(plan)}</option>)}</select></label>
          <label>Phone number for PayU<input id="subscription-checkout-phone" type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label>
          <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => void beginCheckout(checkoutPlan.code, status === 'active' && checkoutPlan.code === subscription.planCode ? 'renewal' : 'plan')}>{checkoutBusyPlanCode === checkoutPlan.code ? 'Opening PayU…' : status === 'active' && checkoutPlan.code === subscription.planCode ? 'Renew current plan' : checkoutPlan.code === subscription.planCode ? 'Pay now' : `Upgrade to ${checkoutPlan.name}`}</button>
          {checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}
        </div>}
      </section>

      <section className="subscription-payment-history" aria-labelledby="subscription-payment-history-title">
        <header><div><span className="auth-step">WORKSPACE BILLING</span><h2 id="subscription-payment-history-title">Plan purchases &amp; payment history</h2><p>Payments and plan activations for this workspace.</p></div></header>
        {paymentHistoryError && <p role="alert">{paymentHistoryError}</p>}
        {!paymentHistoryError && paymentHistory.length === 0 && <p className="subscription-history-empty">No subscription payments have been recorded for this workspace yet.</p>}
        {paymentHistory.length > 0 && <div className="subscription-payment-list">{paymentHistory.map((payment) => {
          const paidPlan = billing.plans.find((plan) => plan.code === payment.planCode);
          const normalizedStatus = payment.status.toLowerCase();
          const statusLabel = normalizedStatus === 'succeeded' ? 'Verified' : normalizedStatus === 'pending' ? 'Pending verification' : normalizedStatus;
          return <article className="subscription-payment-item" key={payment.id}>
            <div className="subscription-payment-item-main"><strong>{payment.paymentType === 'seat_addon' ? `${payment.seatQuantity ?? 0} additional seats` : paidPlan?.name ?? payment.planCode}</strong><span>{payment.paymentType === 'renewal' ? 'Plan renewal' : payment.paymentType === 'seat_addon' ? 'Additional seat purchase' : 'Plan purchase'} · {new Date(payment.createdAt).toLocaleString()}</span></div>
            <div className="subscription-payment-item-amount"><strong>{payment.currency} {Number(payment.amount).toLocaleString('en-IN')}</strong><span className={`subscription-payment-history-status is-${normalizedStatus}`}>{statusLabel}</span></div>
            {(payment.payuId || payment.bankReference) && <small>PayU reference: {payment.payuId ?? payment.bankReference}</small>}
            {payment.failureReason && <p className="subscription-checkout-error">{payment.failureReason}</p>}
            {normalizedStatus === 'pending' && <button className="button button-secondary" type="button" disabled={paymentChecking} onClick={() => void recheckPayment(payment.transactionId)}>{paymentChecking && paymentTransaction === payment.transactionId ? 'Checking…' : 'Check payment'}</button>}
          </article>;
        })}</div>}
      </section>

      {currentPlan && <section className="subscription-payment-history" aria-labelledby="additional-seats-title">
        <header><div><span className="auth-step">TEAM CAPACITY</span><h2 id="additional-seats-title">Additional user seats</h2><p>Paid seats are scoped to this workspace and remain through eligible plan upgrades and renewals.</p></div></header>
        <div className="subscription-seat-summary">
          <article><span>Included seats</span><strong>{billing.seats.included > 0 ? billing.seats.included : 'Unlimited'}</strong></article>
          <article><span>Active additional seats</span><strong>{billing.seats.additional}</strong></article>
          <article><span>Active workspace users</span><strong>{billing.seats.activeUsers}</strong></article>
          <article><span>Pending join requests</span><strong>{billing.seats.pendingUsers}</strong></article>
          <article><span>Total capacity</span><strong>{billing.seats.included > 0 ? billing.seats.included + billing.seats.additional : 'Unlimited'}</strong></article>
          <article><span>Seats remaining</span><strong>{billing.seats.included > 0 ? Math.max(0, billing.seats.included + billing.seats.additional - billing.seats.activeUsers - billing.seats.pendingUsers) : 'Unlimited'}</strong></article>
        </div>
        {canUsePayU && status === 'active' && currentPlan.additionalSeatsEnabled && <div className="subscription-checkout-box subscription-seat-checkout">
          <h3>Purchase seats for this plan period</h3>
          <p>{currentPlan.currency} {currentPlan.additionalSeatPrice.toLocaleString('en-IN')} per seat · {billingIntervalLabel(currentPlan.billingInterval)}</p>
          <label>Additional seats<input type="number" min="1" max="500" step="1" value={additionalSeatQuantity} onChange={(event) => setAdditionalSeatQuantity(event.target.value)} /></label>
          <label>Phone number for PayU<input type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label>
          <p><strong>Due now: {currentPlan.currency} {(currentPlan.additionalSeatPrice * Math.max(0, Number(additionalSeatQuantity) || 0)).toLocaleString('en-IN')}</strong></p>
          <button className="button button-primary" type="button" disabled={checkoutBusy || !Number.isInteger(Number(additionalSeatQuantity)) || Number(additionalSeatQuantity) < 1 || Number(additionalSeatQuantity) > 500} onClick={() => void beginCheckout(currentPlan.code, 'seats', Number(additionalSeatQuantity))}>{checkoutBusyPlanCode === currentPlan.code ? 'Opening PayU…' : 'Purchase additional seats'}</button>
          {checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}
        </div>}
        {canUsePayU && status === 'active' && !currentPlan.additionalSeatsEnabled && <p>Additional seats are not currently offered on this plan. Contact your platform administrator for plan options.</p>}
        {billing.seats.purchases.length > 0 && <div className="subscription-payment-list">{billing.seats.purchases.map((purchase, index) => <article className="subscription-payment-item" key={`${purchase.purchasedAt}-${index}`}>
          <div className="subscription-payment-item-main"><strong>{purchase.quantity} additional {purchase.quantity === 1 ? 'seat' : 'seats'}</strong><span>Purchased {new Date(purchase.purchasedAt).toLocaleDateString()} · {purchase.currency} {purchase.unitPrice.toLocaleString('en-IN')} / seat / {billingIntervalLabel(purchase.billingInterval)}</span></div>
          <span className={`subscription-payment-history-status is-${purchase.status}`}>{purchase.status === 'active' && new Date(purchase.endsAt) > new Date() ? 'Active' : 'Expired'}</span>
          <small>Valid through {date(purchase.endsAt)}</small>
        </article>)}</div>}
      </section>}

      <section className="subscription-feature-center" aria-labelledby="subscription-feature-heading">
        <header className="subscription-feature-header"><div><span className="auth-step">PLAN FEATURE CENTER</span><h2 id="subscription-feature-heading">Explore what each plan unlocks</h2><p>Compare workspace tools, team size, and included modules before choosing an upgrade.</p></div><span className="subscription-feature-orbit" aria-hidden="true" /></header>
        <div className="subscription-feature-tabs" role="tablist" aria-label="Choose a plan to explore">{billing.plans.map((plan) => <button key={plan.code} type="button" role="tab" aria-selected={featurePlanCode === plan.code} className={featurePlanCode === plan.code ? 'is-selected' : ''} onClick={() => setFeaturePlanCode(plan.code)}>{plan.name}{plan.code === subscription.planCode ? ' · Current' : ''}</button>)}</div>
        {billing.plans.filter((plan) => plan.code === featurePlanCode).map((plan) => <article className="subscription-feature-card" key={plan.code}>
          <div className="subscription-feature-card-aura" aria-hidden="true" /><div className="subscription-feature-card-top"><span>{plan.name} workspace plan</span><span className="subscription-feature-price">{money(plan)}</span></div>
          <div className="subscription-feature-card-main"><div><h3>{plan.code === subscription.planCode ? 'Your current toolkit' : `Unlock ${plan.name}`}</h3><p>Built for teams of {plan.seats > 0 ? `up to ${plan.seats}` : 'unlimited'} members.</p><div className="subscription-feature-pills">{plan.modules.map((module) => <span key={module}>{module.replaceAll('-', ' ')}</span>)}</div></div><div className="subscription-feature-benefits"><span>Included capabilities</span>{(plan.features.length ? plan.features : plan.modules.map((module) => module.replaceAll('-', ' '))).map((feature) => <p key={feature}><b>✦</b>{feature}</p>)}</div></div>
          {canUsePayU && status === 'active' && plan.code !== subscription.planCode && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'plan')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : `Upgrade to ${plan.name}`}</button>}
          {canUsePayU && ['pending', 'expired', 'cancelled'].includes(status) && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'plan')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : `Choose ${plan.name}`}</button>}
          {canUsePayU && status === 'active' && plan.code === subscription.planCode && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'renewal')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : 'Renew plan'}</button>}
          {plan.code !== subscription.planCode && billing.partnerPlansUrl && <a className="button button-primary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">Explore this plan</a>}
        </article>)}
        {!billing.plans.length && <p>No plan features are available right now.</p>}
      </section>

      <section className="workspace-renewal-plans" aria-label="Available subscription plans">
        <header className="workspace-plans-heading"><div><span className="auth-step">AVAILABLE PLANS</span><h2>Choose the right plan for your workspace</h2></div><p>Plan changes apply to this workspace only.</p></header>
        {canUsePayU && ['pending', 'expired', 'cancelled'].includes(status) && <div className="subscription-checkout-box subscription-checkout-plans-box" id="subscription-checkout-box"><p>{status === 'pending' ? 'Choose a plan to activate this workspace. The selected plan price will be charged.' : 'Choose a plan to restore workspace access.'}</p><label>Phone number for PayU<input id="subscription-checkout-phone" type="tel" autoComplete="tel" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} placeholder="Enter your phone number" /></label>{checkoutError && <p className="subscription-checkout-error" role="alert">{checkoutError}</p>}</div>}
        {billing.plans.map((plan) => {
          const isCurrent = plan.code === subscription.planCode;
          return <article className="workspace-renewal-plan" key={plan.code}>
            <h2>{plan.name}{isCurrent ? ' · Current plan' : ''}</h2>
            <p><strong>{money(plan)}</strong></p>
            <p>{plan.seats > 0 ? `Up to ${plan.seats} workspace members` : 'Unlimited workspace members'}</p>
            <button className="button button-secondary subscription-plan-details-button" type="button" onClick={() => setDetailsPlanCode(plan.code)}>Plan details &amp; benefits</button>
            {canUsePayU && status === 'active' && !isCurrent && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'plan')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : `Upgrade to ${plan.name}`}</button>}
            {canUsePayU && status === 'pending' && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'plan')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : `Choose ${plan.name}`}</button>}
            {canUsePayU && ['expired', 'cancelled'].includes(status) && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => { setCheckoutPlanCode(plan.code); void beginCheckout(plan.code, 'plan'); }}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : `Choose ${plan.name}`}</button>}
            {canUsePayU && status === 'active' && isCurrent && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => startPlanCheckout(plan.code, 'renewal')}>{checkoutBusyPlanCode === plan.code ? 'Opening PayU…' : 'Renew current plan'}</button>}
            {billing.canManageBilling && billing.partnerPlansUrl && !isCurrent && <a className="button button-secondary" href={billing.partnerPlansUrl} target="_blank" rel="noreferrer">{status === 'active' ? 'Upgrade options' : 'Choose plan'}</a>}
            {!canUsePayU && !billing.partnerPlansUrl && !isCurrent && <p>Contact your platform administrator to change plans.</p>}
          </article>;
        })}
        {!billing.plans.length && <p>No other plans are currently available.</p>}
      </section>

      {detailsPlan && <div className="subscription-plan-details-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsPlanCode(''); }}>
        <section className="subscription-plan-details-dialog" role="dialog" aria-modal="true" aria-labelledby="subscription-plan-details-title">
          <header><div><span className="auth-step">PLAN DETAILS</span><h2 id="subscription-plan-details-title">{detailsPlan.name}{detailsPlan.code === subscription.planCode ? ' · Your current plan' : ''}</h2></div><button type="button" className="button button-secondary" aria-label="Close plan details" onClick={() => setDetailsPlanCode('')}>Close</button></header>
          <p className="subscription-plan-details-price">{money(detailsPlan)}</p>
          <p className="subscription-plan-details-seats">{detailsPlan.seats > 0 ? `Supports up to ${detailsPlan.seats} workspace members.` : 'Supports unlimited workspace members.'}</p>
          <div className="subscription-plan-details-columns">
            <section><h3>Included modules</h3><ul>{detailsPlan.modules.map((module) => <li key={module}>{module.replaceAll('-', ' ')}</li>)}</ul></section>
            <section><h3>Benefits</h3><ul>{(detailsPlan.features.length ? detailsPlan.features : detailsPlan.modules.map((module) => module.replaceAll('-', ' '))).map((feature) => <li key={feature}>{feature}</li>)}</ul></section>
          </div>
          <footer>{canUsePayU && status !== 'active' && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => { setDetailsPlanCode(''); startPlanCheckout(detailsPlan.code, 'plan'); }}>{`Choose ${detailsPlan.name}`}</button>}
            {canUsePayU && status === 'active' && detailsPlan.code === subscription.planCode && <button className="button button-primary" type="button" disabled={checkoutBusy} onClick={() => { setDetailsPlanCode(''); startPlanCheckout(detailsPlan.code, 'renewal'); }}>Renew current plan</button>}
            <button className="button button-secondary" type="button" onClick={() => setDetailsPlanCode('')}>Done</button>
          </footer>
        </section>
      </div>}

      {currentPlan?.modules.includes('billing-invoicing') && <section className="settings-route-grid" aria-label="Billing tools"><Link className="settings-route-card" href="/billing-invoicing"><h2>Billing &amp; Invoicing</h2><p>Create and manage customer invoices, quotations, payments, receipts, products, and billing settings.</p><span>Open billing &amp; invoicing →</span></Link></section>}
    </main></CrmShell>
  );
}
