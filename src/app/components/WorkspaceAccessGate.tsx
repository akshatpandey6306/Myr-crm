'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

export type WorkspaceSubscription = {
  planCode: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  provider: string | null;
};

const SubscriptionContext = createContext<WorkspaceSubscription | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function WorkspaceAccessGate({ children }: { children: ReactNode }) {
  const [subscription, setSubscription] = useState<WorkspaceSubscription | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
    const controller = new AbortController();
    async function checkAccess() {
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
        if (!organization || !current) throw new Error('The billing API returned an invalid response.');
        if (organization.status !== 'active') {
          throw new Error('This workspace has been suspended. Contact your account administrator.');
        }
        const endsAt = typeof current.endsAt === 'string' ? current.endsAt : null;
        const validEndDate = endsAt === null || new Date(endsAt).getTime() > Date.now();
        if (!['active', 'trial'].includes(String(current.status)) || !validEndDate) {
          window.location.assign('/subscription');
          return;
        }
        setSubscription({
          planCode: typeof current.planCode === 'string' ? current.planCode : null,
          status: String(current.status),
          startsAt: typeof current.startsAt === 'string' ? current.startsAt : null,
          endsAt,
          provider: typeof current.provider === 'string' ? current.provider : null,
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
  }, []);

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
  if (!subscription) return null;
  return <SubscriptionContext.Provider value={subscription}>{children}</SubscriptionContext.Provider>;
}

export function SubscriptionExpiryBanner() {
  const subscription = useContext(SubscriptionContext);
  if (!subscription?.endsAt) return null;
  const millisecondsLeft = new Date(subscription.endsAt).getTime() - Date.now();
  const daysLeft = Math.ceil(millisecondsLeft / (24 * 60 * 60 * 1000));
  if (daysLeft < 0 || daysLeft > 1) return null;
  const remaining = daysLeft === 0 ? 'today' : `in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;

  return (
    <div className="subscription-expiry-banner" role="status">
      <span>Your subscription is about to end {remaining}.</span>
      <a href="/subscription">View plan</a>
    </div>
  );
}
