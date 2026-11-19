import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

describe('auth proxy', () => {
  it('allows a request with the API session cookie', () => {
    const request = new NextRequest('http://localhost/control-panel', {
      headers: { cookie: 'myr_session=session-token' },
    });

    expect(proxy(request).status).toBe(200);
  });

  it('redirects requests without a session cookie to sign-in', () => {
    const request = new NextRequest('http://localhost/control-panel');
    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/sign-in');
  });

  it('allows public logo assets without a session cookie', () => {
    for (const path of ['/advance-solution-logo.svg', '/leadpilot-advance-solution.svg']) {
      expect(proxy(new NextRequest(`http://localhost${path}`)).status).toBe(200);
    }
  });
});
