import { crmApiFetch } from './api-client';

const availableModules = new Set([
  'leads',
  'contacts',
  'companies',
  'deals',
  'activities',
  'team',
  'automation',
  'email',
  'reports',
  'audit-logs',
  'settings',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function fetchEnabledModules(signal?: AbortSignal): Promise<string[]> {
  const response = await crmApiFetch('/organizations/modules', signal ? { signal } : {});
  const payload: unknown = await response.json();
  if (!response.ok) {
    const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Could not load workspace module access.');
  }
  const data = isRecord(payload) ? payload.data : null;
  if (!isRecord(data) || !Array.isArray(data.enabledModules) ||
      data.enabledModules.some((module) => typeof module !== 'string' || !availableModules.has(module))) {
    throw new Error('The module access API returned an invalid response.');
  }
  return data.enabledModules;
}
