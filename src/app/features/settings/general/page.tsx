'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { Input, Select, Card, Button } from '../../../components/ui';

type GeneralSettings = {
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  currency: string;
  theme: string;
};

export default function GeneralSettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings>({
    language: 'en',
    timezone: 'UTC',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12-hour',
    currency: 'USD',
    theme: 'light',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        // In production, fetch from API
        setLoading(false);
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <span>Loading...</span>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <main className="settings-page">
      <div className="settings-container">
        <aside className="settings-sidebar">
          <h2>General Settings</h2>
        </aside>
        <section className="settings-main">
          <div className="breadcrumbs">
            <span>General</span>
          </div>
          <div className="settings-content">
            <h1>General Settings</h1>
            <p>Application preferences and configuration</p>
            <p>Settings saved successfully!</p>
          </div>
        </section>
      </div>
    </main>
  );
}
