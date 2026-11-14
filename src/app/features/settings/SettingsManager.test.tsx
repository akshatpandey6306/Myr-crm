import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../../lib/api-client';
import SettingsManager from './SettingsManager';

vi.mock('../../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('myr.crm.theme');
  delete document.documentElement.dataset.crmTheme;
});

const apiFetchMock = vi.mocked(crmApiFetch);
const initialSettings = {
  organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationName: 'Northstar Studio',
  currency: 'USD',
  timezone: 'UTC',
  weekStartsOn: 1,
  updatedAt: null,
  canEdit: true,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SettingsManager', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (_path, init = {}) => {
      if (init.method === 'PATCH') return jsonResponse({ data: { ...initialSettings, currency: 'EUR', updatedAt: '2026-10-30T12:00:00.000Z' } });
      return jsonResponse({ data: initialSettings });
    });
  });

  it('loads settings and saves workspace preferences through the API', async () => {
    const user = userEvent.setup();
    render(<SettingsManager />);

    const currency = await screen.findByRole('combobox', { name: /Currency/ });
    await user.selectOptions(currency, 'EUR');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Workspace settings saved');
    expect(apiFetchMock).toHaveBeenCalledWith('/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ organizationName: 'Northstar Studio', currency: 'EUR', timezone: 'UTC', weekStartsOn: 1 }),
    }));
  });

  it('keeps preferences read-only when the server says the member cannot edit', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ data: { ...initialSettings, canEdit: false } }));
    render(<SettingsManager />);

    expect(await screen.findByLabelText('Workspace name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('applies a selected CRM theme and can restore the default colors', async () => {
    const user = userEvent.setup();
    render(<SettingsManager />);

    await user.click(screen.getByRole('button', { name: 'Teal' }));
    expect(document.documentElement).toHaveAttribute('data-crm-theme', 'teal');
    expect(window.localStorage.getItem('myr.crm.theme')).toBe('teal');

    await user.click(screen.getByRole('button', { name: 'Use default color' }));
    expect(document.documentElement).toHaveAttribute('data-crm-theme', 'default');
    expect(window.localStorage.getItem('myr.crm.theme')).toBe('default');
  });
});