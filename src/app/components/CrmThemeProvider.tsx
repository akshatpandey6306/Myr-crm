'use client';

import { useEffect, type ReactNode } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { isCrmTheme, type CrmTheme } from '../../lib/crm-theme';

export default function CrmThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let controller: AbortController | null = null;
    const loadWorkspaceTheme = () => {
      controller?.abort();
      const activeController = new AbortController();
      controller = activeController;
      const shell = document.querySelector<HTMLElement>('.app-shell');
      if (!shell) return;
      void crmApiFetch('/settings', { signal: activeController.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Could not load workspace appearance');
          const payload = await response.json() as { data?: { crmTheme?: unknown } };
          const theme = payload.data?.crmTheme;
          shell.dataset.crmTheme = typeof theme === 'string' && isCrmTheme(theme) ? theme : 'default';
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'AbortError')) shell.removeAttribute('data-crm-theme');
        });
    };
    let observedShell: HTMLElement | null = null;
    const observer = new MutationObserver(() => {
      const shell = document.querySelector<HTMLElement>('.app-shell');
      if (shell && shell !== observedShell) {
        observedShell = shell;
        loadWorkspaceTheme();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    loadWorkspaceTheme();
    window.addEventListener('myr:organization-changed', loadWorkspaceTheme);
    return () => {
      controller?.abort();
      observer.disconnect();
      window.removeEventListener('myr:organization-changed', loadWorkspaceTheme);
    };
  }, []);

  return children;
}
