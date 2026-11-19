import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../../lib/api-client';
import BillingManager from './BillingManager';

vi.mock('../../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('BillingManager invoice drafts', () => {
  it('saves edited draft values before retrying issue', async () => {
    let issueAttempts = 0;
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path === '/invoicing/dashboard') {
        return jsonResponse({ data: {
          currency: 'USD', invoices: 0, invoiced: '0', received: '0', outstanding: '0',
          overdueAmount: '0', overdueCount: 0, paidCount: 0, partiallyPaidCount: 0, unpaidCount: 0,
          monthlyRevenue: [], recentInvoices: [], recentPayments: [],
        } });
      }
      if (path === '/invoicing/settings') {
        return jsonResponse({ data: {
          currency: 'USD', currencyPrecision: 2, countryCode: 'US', taxSystem: 'GENERIC',
          businessName: null, businessEmail: null, businessPhone: null, businessAddress: null,
          gstin: null, registrationStateCode: null, invoicePrefix: 'INV', quotePrefix: 'QTN',
          receiptPrefix: 'REC', defaultDueDays: 30, defaultTaxRate: '0', defaultTerms: null,
        } });
      }
      if (path === '/invoicing/products') return jsonResponse({ data: [] });
      if (path === '/invoicing/customers') {
        return jsonResponse({ data: {
          contacts: [{ id: 'contact-a', name: 'Olivia Rhye', email: 'olivia@example.test', phone: null, type: 'contact' }],
          companies: [],
        } });
      }
      if (path === '/invoicing/invoices' && init.method === 'POST') return jsonResponse({ data: { id: 'draft-a' } });
      if (path === '/invoicing/invoices/draft-a' && init.method === 'PATCH') return jsonResponse({ data: { id: 'draft-a' } });
      if (path === '/invoicing/invoices/draft-a/issue' && init.method === 'POST') {
        issueAttempts += 1;
        return issueAttempts === 1
          ? jsonResponse({ error: { message: 'Invoice total must be positive' } }, 400)
          : jsonResponse({ data: { id: 'draft-a', status: 'ISSUED' } });
      }
      if (path.startsWith('/invoicing/invoices?')) return jsonResponse({ data: [], meta: { total: 0, totalPages: 1 } });
      return jsonResponse({ error: { message: `Unexpected request: ${path}` } }, 404);
    });

    const user = userEvent.setup();
    render(<BillingManager />);
    await screen.findByText('No invoices yet');
    await user.click(screen.getByRole('button', { name: '＋ Create invoice' }));
    await user.selectOptions(screen.getByLabelText('Customer'), 'contact-a');
    await user.type(screen.getByLabelText('Description'), 'Consulting');
    await user.click(screen.getByRole('button', { name: 'Save & issue' }));
    await screen.findByRole('button', { name: 'Retry issue' });

    await user.clear(screen.getByLabelText('Unit price'));
    await user.type(screen.getByLabelText('Unit price'), '100');
    await user.click(screen.getByRole('button', { name: 'Retry issue' }));

    await waitFor(() => {
      const calls = apiFetchMock.mock.calls.map(([path, init]) => ({ path, init }));
      const draftUpdate = calls.find(({ path, init }) => path === '/invoicing/invoices/draft-a' && init?.method === 'PATCH');
      const issued = calls.filter(({ path, init }) => path === '/invoicing/invoices/draft-a/issue' && init?.method === 'POST');
      expect(draftUpdate).toBeDefined();
      expect(JSON.parse(String(draftUpdate?.init?.body)).items[0].unitPrice).toBe('100');
      expect(issued).toHaveLength(2);
    });
  });
});
