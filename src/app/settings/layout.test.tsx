import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsLayout from './layout';

vi.mock('../components/CrmShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(cleanup);

describe('SettingsLayout', () => {
  it('provides CRM navigation and a direct route back to the overview', () => {
    render(<SettingsLayout><p>Settings content</p></SettingsLayout>);

    expect(screen.getByRole('link', { name: 'Back to CRM' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    expect(screen.getByText('Settings content')).toBeInTheDocument();
  });
});
