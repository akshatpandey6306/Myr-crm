import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../lib/api-client';
import { subscriptionDaysRemaining, SubscriptionExpiryBanner, WorkspaceAccessGate } from './WorkspaceAccessGate';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/leads' }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('subscription expiry', () => {
  it('counts down the final ten days using the expiry timestamp', () => {
    const now = Date.parse('2026-11-15T12:00:00.000Z');

    expect(subscriptionDaysRemaining(new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(10);
    expect(subscriptionDaysRemaining(new Date(now + 24 * 60 * 60 * 1000).toISOString(), now)).toBe(1);
    expect(subscriptionDaysRemaining(new Date(now - 1).toISOString(), now)).toBe(0);
    expect(subscriptionDaysRemaining('not-a-date', now)).toBeNull();
  });

  it('shows the remaining-day countdown inside the workspace header context', async () => {
    const endsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    apiFetchMock.mockImplementation(async (path) => {
      if (path === '/control-panel/access') return jsonResponse({ error: { code: 'forbidden' } }, 403);
      if (path === '/billing/current') {
        return jsonResponse({ data: {
          organization: { id: 'org-a', name: 'Acme', status: 'active' },
          subscription: { planCode: 'growth', status: 'trial', startsAt: null, endsAt, provider: 'manual' },
          activationRequest: null,
          plans: [],
          canManageBilling: true,
        } });
      }
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });

    render(<WorkspaceAccessGate><SubscriptionExpiryBanner /></WorkspaceAccessGate>);

    const countdown = await screen.findByText('days left before plan expiry');
    expect(countdown.parentElement).toHaveTextContent('5');
    expect(screen.getByRole('link', { name: 'Renew' })).toHaveAttribute('href', '/subscription');
  });

  it('locks an expired workspace behind the renewal overlay and submits a request', async () => {
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path === '/control-panel/access') return jsonResponse({ error: { message: 'forbidden' } }, 403);
      if (path === '/billing/current') {
        return jsonResponse({ data: {
          organization: { id: 'org-a', name: 'Acme', status: 'active' },
          subscription: { planCode: 'growth', status: 'expired', startsAt: null, endsAt: '2026-11-14T12:00:00.000Z', provider: 'manual' },
          activationRequest: null,
          plans: [{ code: 'growth', name: 'Growth', monthlyPrice: 999, currency: 'INR', billingInterval: 'monthly', features: ['CRM access'] }],
          canManageBilling: true,
        } });
      }
      if (path === '/billing/request-activation' && init.method === 'POST') {
        return jsonResponse({ data: { id: 'request-a', planCode: 'growth', requestType: 'activation', requestedAt: '2026-11-15T12:00:00.000Z' } });
      }
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });

    const user = userEvent.setup();
    render(<WorkspaceAccessGate><div data-testid="crm-workspace">Private CRM data</div></WorkspaceAccessGate>);

    const dialog = await screen.findByRole('dialog', { name: 'Acme is paused' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('crm-workspace').parentElement).toHaveAttribute('inert');
    expect(screen.getByTestId('crm-workspace').parentElement).toHaveAttribute('aria-hidden', 'true');

    await user.click(screen.getByRole('button', { name: 'Request renewal' }));
    expect(await screen.findByText(/Renewal request sent/)).toBeInTheDocument();
    expect(apiFetchMock).toHaveBeenCalledWith('/billing/request-activation', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ planCode: 'growth' }),
    }));
  });
});