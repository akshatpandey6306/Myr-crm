import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

describe('auth proxy', () => {
  it('allows a request with the API session cookie', () => {
    const request = new NextRequest('http://localhost/control-panel', {
      headers: { cookie: 'myr_session=session-token' },
    });

    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");
  });

  it('redirects requests without a session cookie to sign-in', () => {
    const request = new NextRequest('http://localhost/control-panel');
    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/sign-in');
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe('/control-panel');
    expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
  });

  it('allows public logo assets without a session cookie', () => {
    for (const path of ['/advance-solution-logo.svg', '/leadpilot-advance-solution.svg']) {
      expect(proxy(new NextRequest(`http://localhost${path}`)).status).toBe(200);
    }
  });

  it('uses a fresh nonce for each response and permits inline scripts only with that nonce', () => {
    const first = proxy(new NextRequest('http://localhost/sign-in'));
    const second = proxy(new NextRequest('http://localhost/sign-in'));
    const firstNonce = first.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = second.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });
});
