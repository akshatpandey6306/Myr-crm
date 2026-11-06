import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import AuthForm from './AuthForm';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

describe('AuthForm', () => {
  it('renders password-manager-sensitive fields only after hydration', async () => {
    const serverHtml = renderToString(<AuthForm mode="signin" />);
    expect(serverHtml).not.toContain('name="email"');
    expect(serverHtml).not.toContain('name="password"');
    expect(serverHtml).toContain('Preparing secure sign-in');

    render(<AuthForm mode="signin" />);
    expect(await screen.findByRole('textbox', { name: 'Work email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
