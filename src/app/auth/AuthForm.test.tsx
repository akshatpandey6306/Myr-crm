import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { crmApiFetch } from '../../lib/api-client';
import AuthForm from './AuthForm';

vi.mock('../../lib/api-client', () => ({ crmApiFetch: vi.fn() }));

afterEach(cleanup);

describe('AuthForm', () => {
  it('requires the signup OTP before activating a workspace owner account', async () => {
    const apiFetch = vi.mocked(crmApiFetch);
    apiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Verification code sent.' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Account verified.' }),
      } as Response);

    render(<AuthForm mode="signup" />);
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Maya Chen' } });
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Northwind' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'maya@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /Create account/ }).closest('form')!);

    const otpInput = await screen.findByLabelText('Verification code');
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/auth/signup', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        accountType: 'workspace',
        name: 'Maya Chen',
        organizationName: 'Northwind',
        email: 'maya@example.com',
        password: 'password123',
      }),
    }));

    fireEvent.change(otpInput, { target: { value: '123456' } });
    fireEvent.submit(screen.getByRole('button', { name: /Verify account/ }).closest('form')!);

    expect(await screen.findByText('Account verified.')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/auth/signup/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'maya@example.com', otp: '123456' }),
    }));
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });

  it('shows OTP entry and resend when initial email delivery fails after signup', async () => {
    vi.mocked(crmApiFetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: 'signup_otp_delivery_failed',
          message: 'We could not deliver the verification email. Request a new code and try again.',
        },
      }),
    } as Response);

    render(<AuthForm mode="signup" />);
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Maya Chen' } });
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Northwind' } });
    fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'maya@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: /Create account/ }).closest('form')!);

    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend verification code' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not deliver the verification email.');
  });

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
