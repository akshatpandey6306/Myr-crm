const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/+$/, '');
let refreshRequest: Promise<boolean> | undefined;

/** Add the current bearer token and active tenant to an API request. */
export function crmApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof window !== 'undefined') {
    const token = window.sessionStorage.getItem('myr.session');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const savedOrganization = window.sessionStorage.getItem('myr.organization');
    if (savedOrganization) {
      try {
        const organization = JSON.parse(savedOrganization) as { id?: unknown };
        if (typeof organization.id === 'string' && organization.id) headers.set('x-organization-id', organization.id);
      } catch { /* Ignore invalid local state; the API will require a valid tenant context. */ }
    }
  }
  const route = path.startsWith('/') ? path : `/${path}`;
  const expiresAt = typeof window === 'undefined'
    ? Number.NaN
    : Number(window.sessionStorage.getItem('myr.session.expiresAt'));
  const needsRefresh = Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000;
  const beforeRequest = needsRefresh ? refreshSession() : Promise.resolve(true);
  return beforeRequest.then(async (refreshed) => {
    const response = await fetch(`${API_BASE_URL}${route}`, { ...init, credentials: init.credentials ?? 'same-origin', headers });
    if (!needsRefresh && response.status === 401 && !route.startsWith('/auth/')) {
      const rotated = await refreshSession();
      if (rotated) return crmApiFetch(path, { ...init, headers: init.headers });
    }
    if (needsRefresh && !refreshed) return response;
    return response;
  });
}

function refreshSession() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (refreshRequest) return refreshRequest;
  const token = window.sessionStorage.getItem('myr.session');
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
  }).then(async (response) => {
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || !('token' in payload) || typeof payload.token !== 'string' ||
      !('expiresAt' in payload) || typeof payload.expiresAt !== 'string') {
      throw new Error('The session refresh response was incomplete.');
    }
    if (token) window.sessionStorage.setItem('myr.session', payload.token);
    window.sessionStorage.setItem('myr.session.expiresAt', String(Date.parse(payload.expiresAt)));
    return true;
  }).finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}
