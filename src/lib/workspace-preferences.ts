export function workspacePreferenceKey(preference: string) {
  let organizationId = 'guest';
  try {
    const activeOrganization = window.sessionStorage.getItem('myr.organization');
    if (activeOrganization) {
      const parsed = JSON.parse(activeOrganization) as { id?: unknown };
      if (typeof parsed.id === 'string' && parsed.id) organizationId = parsed.id;
    }
  } catch {
    // Use a separate guest preference when workspace state is unavailable.
  }
  return `myr.workspace.${organizationId}.${preference}`;
}

export function readWorkspacePreference(preference: string) {
  try {
    return window.localStorage.getItem(workspacePreferenceKey(preference));
  } catch {
    return null;
  }
}

export function writeWorkspacePreference(preference: string, value: string) {
  try {
    window.localStorage.setItem(workspacePreferenceKey(preference), value);
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
}
