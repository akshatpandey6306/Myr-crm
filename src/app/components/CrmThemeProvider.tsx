'use client';

import { useEffect, type ReactNode } from 'react';
import {
  CRM_THEME_CHANGE_EVENT,
  CRM_THEME_STORAGE_KEY,
  isCrmTheme,
  readCrmTheme,
} from '../../lib/crm-theme';

export default function CrmThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const applyStoredTheme = () => {
      document.documentElement.dataset.crmTheme = readCrmTheme();
    };
    const applyStoredThemeFromOtherTab = (event: StorageEvent) => {
      if (event.key === CRM_THEME_STORAGE_KEY) {
        document.documentElement.dataset.crmTheme = isCrmTheme(event.newValue) ? event.newValue : 'default';
      }
    };

    applyStoredTheme();
    window.addEventListener(CRM_THEME_CHANGE_EVENT, applyStoredTheme);
    window.addEventListener('storage', applyStoredThemeFromOtherTab);
    return () => {
      window.removeEventListener(CRM_THEME_CHANGE_EVENT, applyStoredTheme);
      window.removeEventListener('storage', applyStoredThemeFromOtherTab);
    };
  }, []);

  return children;
}
