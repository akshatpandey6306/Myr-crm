const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || '/api/v1').replace(/\/+$/, '');
const API_CREDENTIALS: RequestCredentials = /^https?:\/\//i.test(API_BASE_URL) ? 'include' : 'same-origin';

/** Add the active tenant to an API request; authentication uses the HttpOnly session cookie. */
export function crmApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof window !== 'undefined') {
    const savedOrganization = window.sessionStorage.getItem('myr.organization');
    if (savedOrganization) {
      try {
        const organization = JSON.parse(savedOrganization) as { id?: unknown };
        if (typeof organization.id === 'string' && organization.id) headers.set('x-organization-id', organization.id);
      } catch { /* Ignore invalid local state; the API will require a valid tenant context. */ }
    }
  }
  const route = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${API_BASE_URL}${route}`, { ...init, headers, credentials: API_CREDENTIALS });
}
