import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../lib/api-client';
import { subscriptionDaysRemaining, SubscriptionExpiryBanner, WorkspaceAccessGate } from './WorkspaceAccessGate';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/leads' }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
          subscription: { planCode: 'growth', status: 'active', startsAt: null, endsAt, provider: 'manual' },
          activationRequest: null,
          plans: [],
          canManageBilling: true,
          payuEnabled: false,
        } });
      }
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });

    render(<WorkspaceAccessGate><SubscriptionExpiryBanner /></WorkspaceAccessGate>);

    const countdown = await screen.findByText(/days until plan expiry/);
    expect(countdown.parentElement).toHaveTextContent('5');
    expect(screen.getByRole('link', { name: /renew/i })).toHaveAttribute('href', '/subscription');
  });

  it('locks an expired workspace behind the renewal overlay and submits a request', async () => {
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path === '/control-panel/access') return jsonResponse({ error: { message: 'forbidden' } }, 403);
      if (path === '/billing/current') {
        return jsonResponse({ data: {
          organization: { id: 'org-a', name: 'Acme', status: 'active' },
          subscription: { planCode: 'growth', status: 'expired', startsAt: null, endsAt: '2026-11-14T12:00:00.000Z', provider: 'manual' },
          activationRequest: null,
          plans: [{ code: 'growth', name: 'Growth', monthlyPrice: 999, currency: 'INR', billingInterval: 30, features: ['CRM access'] }],
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

  it('posts the renewal checkout and reports that it is redirecting to PayU', async () => {
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    apiFetchMock.mockImplementation(async (path) => {
      if (path === '/control-panel/access') return jsonResponse({ error: { message: 'forbidden' } }, 403);
      if (path === '/billing/current') {
        return jsonResponse({ data: {
          organization: { id: 'org-a', name: 'Acme', status: 'active' },
          subscription: { planCode: 'growth', status: 'expired', startsAt: null, endsAt: '2026-11-14T12:00:00.000Z', provider: 'payu' },
          activationRequest: null,
          plans: [{ code: 'growth', name: 'Growth', monthlyPrice: 999, currency: 'INR', billingInterval: 30, features: ['CRM access'] }],
          canManageBilling: true,
          payuEnabled: true,
        } });
      }
      if (path === '/billing/checkout') {
        return jsonResponse({ data: {
          checkoutUrl: 'https://test.payu.in/_payment',
          fields: {
            key: 'merchant-key', txnid: 'transaction-id', amount: '999.00', productinfo: 'LeadPilot Growth',
            firstname: 'Aditya', email: 'aditya@example.com', phone: '6306443348',
            surl: 'https://crm.example.com/api/v1/billing/payu/return',
            furl: 'https://crm.example.com/api/v1/billing/payu/return', hash: 'signed-hash',
          },
        } });
      }
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });

    const user = userEvent.setup();
    render(<WorkspaceAccessGate><div>CRM</div></WorkspaceAccessGate>);
    await screen.findByRole('dialog', { name: 'Acme is paused' });
    await user.type(screen.getByLabelText('Phone number for PayU'), '6306443348');
    await user.click(screen.getByRole('button', { name: 'Pay INR 999 with PayU' }));

    expect(await screen.findByRole('button', { name: 'Redirecting to PayU…' })).toBeDisabled();
    expect(requestSubmit).toHaveBeenCalledOnce();
    expect(apiFetchMock).toHaveBeenCalledWith('/billing/checkout', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ planCode: 'growth', purchaseType: 'plan', phone: '6306443348' }),
    }));
    window.dispatchEvent(new Event('pagehide'));
  });
});
