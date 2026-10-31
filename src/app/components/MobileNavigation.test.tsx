import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import MobileNavigation from './MobileNavigation';

afterEach(cleanup);

describe('MobileNavigation', () => {
  it('opens the menu and closes it from the backdrop or Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(<MobileNavigation active="Activities" />);

    await user.click(screen.getByRole('button', { name: 'Open main menu' }));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activities' })).toHaveAttribute('aria-current', 'page');

    const backdrop = container.querySelector('.mobile-nav-layer');
    if (!backdrop) throw new Error('Mobile navigation backdrop was not rendered.');
    await user.click(backdrop);
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open main menu' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});
