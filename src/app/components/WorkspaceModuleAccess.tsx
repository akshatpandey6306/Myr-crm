'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { fetchEnabledModules } from '../../lib/module-permissions';

const WorkspaceModuleAccessContext = createContext<string[] | null>(null);

export function WorkspaceModuleAccessProvider({ children }: { children: ReactNode }) {
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);

  useEffect(() => {
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      const requestController = new AbortController();
      controller = requestController;
      setEnabledModules(null);
      void fetchEnabledModules(requestController.signal)
        .then(setEnabledModules)
        .catch(() => {
          if (!requestController.signal.aborted) setEnabledModules([]);
        });
    };
    load();
    window.addEventListener('myr:organization-changed', load);
    return () => {
      controller.abort();
      window.removeEventListener('myr:organization-changed', load);
    };
  }, []);

  return <WorkspaceModuleAccessContext.Provider value={enabledModules}>{children}</WorkspaceModuleAccessContext.Provider>;
}

export function useWorkspaceModuleAccess() {
  return useContext(WorkspaceModuleAccessContext);
}
