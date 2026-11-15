'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

export default function ClearSampleDataButton() {
  const [visible, setVisible] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [samplesLoaded, setSamplesLoaded] = useState(false);

  useEffect(() => {
    let controller: AbortController | null = null;
    const checkSampleData = () => {
      controller?.abort();
      controller = new AbortController();
      const activeController = controller;
      setVisible(false);
      void (async () => {
        try {
          const userResponse = await crmApiFetch('/auth/me', { signal: activeController.signal });
          if (!userResponse.ok) return;
          const userPayload: unknown = await userResponse.json();
          if (!userPayload || typeof userPayload !== 'object' || !('organizations' in userPayload) || !Array.isArray(userPayload.organizations)) return;
          let selectedId = '';
          try {
            const stored = sessionStorage.getItem('myr.organization');
            const selected = stored ? JSON.parse(stored) as { id?: unknown } : null;
            if (selected && typeof selected.id === 'string') selectedId = selected.id;
          } catch { /* Ignore invalid cached workspace data. */ }
          const organizations = userPayload.organizations as { id?: unknown; role?: unknown }[];
          const selectedOrganization = organizations.find((organization) => organization.id === selectedId) ?? organizations[0];
          if (selectedOrganization?.role !== 'owner' && selectedOrganization?.role !== 'admin') return;

          const statusResponse = await crmApiFetch('/demo-data/status', { signal: activeController.signal });
          if (!statusResponse.ok) return;
          const statusPayload: unknown = await statusResponse.json();
          if (!statusPayload || typeof statusPayload !== 'object' || !('data' in statusPayload)) return;
          const data = (statusPayload as { data?: unknown }).data;
          if (data && typeof data === 'object' && 'loaded' in data && !activeController.signal.aborted) {
            setVisible(true);
            setSamplesLoaded(data.loaded === true);
            if (data.loaded === true) window.dispatchEvent(new Event('myr:demo-data-changed'));
          }
        } catch {
          // Hide the control when sample status cannot be checked; do not show a workspace error banner.
        }
      })();
    };
    checkSampleData();
    window.addEventListener('myr:organization-changed', checkSampleData);
    return () => {
      window.removeEventListener('myr:organization-changed', checkSampleData);
      controller?.abort();
    };
  }, []);

  async function clearSampleData() {
    setClearing(true);
    try {
      const response = await crmApiFetch('/demo-data/clear', { method: 'DELETE' });
      if (!response.ok) return;
      setVisible(false);
      window.dispatchEvent(new Event('myr:demo-data-changed'));
    } catch {
      // Keep the control available so the workspace admin can retry.
    } finally {
      setClearing(false);
    }
  }

  async function loadSampleData() {
    setLoadingSamples(true);
    try {
      const response = await crmApiFetch('/demo-data/load', { method: 'POST' });
      if (!response.ok) return;
      setSamplesLoaded(true);
      window.dispatchEvent(new Event('myr:demo-data-changed'));
    } catch {
      // Leave the load action available so the workspace admin can retry.
    } finally {
      setLoadingSamples(false);
    }
  }

  if (!visible) return null;

  return <>{samplesLoaded
    ? <button className="clear-sample-data-button" type="button" onClick={() => void clearSampleData()} disabled={clearing}>{clearing ? 'Clearing sample data…' : 'Clear sample data'}</button>
    : <button className="clear-sample-data-button" type="button" onClick={() => void loadSampleData()} disabled={loadingSamples}>{loadingSamples ? 'Loading sample data…' : 'Load sample data'}</button>}
  </>;
}
