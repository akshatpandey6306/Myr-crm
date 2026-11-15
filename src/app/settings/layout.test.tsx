import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crmApiFetch } from '../../lib/api-client';
import SettingsLayout from './layout';

const { mockedPathname, mockedReplace } = vi.hoisted(() => ({
  mockedPathname: vi.fn(() => '/settings'),
  mockedReplace: vi.fn(),
}));

vi.mock('../components/CrmShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('next/navigation', () => ({
  usePathname: mockedPathname,
  useRouter: () => ({ replace: mockedReplace }),
}));

vi.mock('../../lib/api-client', () => ({
  crmApiFetch: vi.fn(),
}));

afterEach(cleanup);

describe('SettingsLayout', () => {
  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('provides CRM navigation and a direct route back to the overview', () => {
    vi.mocked(crmApiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ organizations: [{ id: 'org-1', role: 'owner' }] }),
    } as Response);

    render(<SettingsLayout><p>Settings content</p></SettingsLayout>);

    expect(screen.getByRole('link', { name: 'Back to CRM' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });

  it('hides team settings from members and redirects direct team-settings routes', async () => {
    mockedPathname.mockReturnValue('/settings/users');
    vi.mocked(crmApiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ organizations: [{ id: 'org-1', role: 'sales_rep' }] }),
    } as Response);

    render(<SettingsLayout><p>Team settings</p></SettingsLayout>);

    await waitFor(() => expect(mockedReplace).toHaveBeenCalledWith('/settings'));
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByText('Team settings')).not.toBeInTheDocument();
  });
});
