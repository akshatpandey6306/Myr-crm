import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../lib/api-client';
import MobileNavigation from './MobileNavigation';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

const apiFetchMock = vi.mocked(crmApiFetch);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('MobileNavigation', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation(async (path) => {
      if (path === '/auth/me') return jsonResponse({ user: { name: 'Riley Chen', email: 'riley@example.com' } });
      if (path === '/auth/logout') return jsonResponse({ ok: true }, 201);
      return jsonResponse({ error: { message: 'Unexpected request' } }, 404);
    });
  });

  it('opens the menu and closes it from the backdrop or Escape', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation active="Activities" />);

    await user.click(screen.getByRole('button', { name: 'Open main menu' }));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activities' })).toHaveAttribute('aria-current', 'page');

    const backdrop = document.body.querySelector('.mobile-nav-layer');
    if (!backdrop) throw new Error('Mobile navigation backdrop was not rendered.');
    expect(backdrop.parentElement).toBe(document.body);
    await user.click(backdrop);
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open main menu' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });

  it('shows the signed-in user and a sign-out action in the mobile menu', async () => {
    const user = userEvent.setup();
    render(<MobileNavigation active="Overview" />);

    await user.click(screen.getByRole('button', { name: 'Open main menu' }));
    expect(await screen.findByText('Riley Chen')).toBeInTheDocument();
    expect(screen.getByText('riley@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(apiFetchMock).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });
});
