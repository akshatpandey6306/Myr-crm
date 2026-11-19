import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../../lib/api-client';
import VendorsManager from './VendorsManager';

vi.mock('../../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);
const vendor = {
  id: 'vendor-1',
  name: 'Northstar Supply',
  category: 'Office Supplies',
  contactPerson: 'Maya Chen',
  email: 'maya@northstar.example',
  phone: null,
  status: 'ACTIVE',
  rating: 4.8,
  reviewCount: 12,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
};
let activeVendor = vendor;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('VendorsManager', () => {
  beforeEach(() => {
    activeVendor = vendor;
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path, init = {}) => {
      if (path.startsWith('/vendors?')) return jsonResponse({ data: [activeVendor], meta: { total: 1, totalPages: 1 } });
      if (path === '/vendors/summary') return jsonResponse({ data: { total: 1, active: 1, pending: 0, onHold: 0 } });
      if (path === '/vendors/categories') return jsonResponse({ data: ['Office Supplies'] });
      if (path === '/vendors' && init.method === 'POST') return jsonResponse({ data: { ...vendor, id: 'vendor-2' } });
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });
  });

  it('shows workspace vendor records and their summary', async () => {
    render(<VendorsManager />);

    expect(await screen.findByText('Northstar Supply')).toBeInTheDocument();
    expect(screen.getByText('maya@northstar.example')).toBeInTheDocument();
    expect(screen.getByText('Active', { selector: '.vendor-status' })).toBeInTheDocument();
    expect(screen.getByText('4.8')).toBeInTheDocument();
    expect(screen.getByText('Total Vendors').parentElement).toHaveTextContent('1');
  });

  it('creates a vendor through the tenant-scoped API', async () => {
    const user = userEvent.setup();
    render(<VendorsManager />);
    await screen.findByText('Northstar Supply');

    await user.click(screen.getByRole('button', { name: 'Add Vendor' }));
    await user.type(screen.getByLabelText(/Vendor name/), 'Bluebird Logistics');
    await user.type(screen.getByLabelText(/Category/), 'Shipping');
    await user.type(screen.getByLabelText(/Contact person/), 'Jordan Lee');
    await user.click(screen.getByRole('button', { name: 'Create vendor' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Bluebird Logistics was added.');
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/vendors', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"name":"Bluebird Logistics"'),
    })));
  });

  it('replaces vendor records when the active workspace changes', async () => {
    render(<VendorsManager />);
    expect(await screen.findByText('Northstar Supply')).toBeInTheDocument();

    activeVendor = { ...vendor, id: 'vendor-b', name: 'Bluebird Logistics', category: 'Shipping' };
    window.dispatchEvent(new Event('myr:organization-changed'));

    expect(await screen.findByText('Bluebird Logistics')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Northstar Supply')).not.toBeInTheDocument());
  });

  it('refreshes vendor records when sample data changes', async () => {
    render(<VendorsManager />);
    expect(await screen.findByText('Northstar Supply')).toBeInTheDocument();

    activeVendor = { ...vendor, id: 'vendor-demo', name: 'Forma Cloud Services', category: 'Technology' };
    window.dispatchEvent(new Event('myr:demo-data-changed'));

    expect(await screen.findByText('Forma Cloud Services')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Northstar Supply')).not.toBeInTheDocument());
  });
});
