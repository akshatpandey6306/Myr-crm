'use client';

import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { Card, Input, Select, Button } from '../components/ui';

type LeadSource = { id: string; name: string; key: string };
type LeadStatus = { id: string; name: string; key: string };
type LeadPriority = { id: string; name: string; key: string };
type LeadSetting = { id: string; key: string; value: string; organizationId: string };

export default function LeadSettingsPage() {
  const [leadSources, setLeadSources] = useState<LeadSource[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<LeadStatus[]>([]);
  const [leadPriorities, setLeadPriorities] = useState<LeadPriority[]>([]);
  const [settings, setSettings] = useState<LeadSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        
        const settingsResponse = await crmApiFetch('/settings/leads');
        setSettings(settingsResponse as LeadSetting[]);
        
        // Seed some default lead sources, statuses, priorities
        const sources: LeadSource[] = [
          { id: '1', name: 'Website', key: 'website' },
          { id: '2', name: 'Referral', key: 'referral' },
          { id: '3', name: 'LinkedIn', key: 'linkedin' },
        ];
        
        const statuses: LeadStatus[] = [
          { id: '1', name: 'New', key: 'new' },
          { id: '2', name: 'Contacted', key: 'contacted' },
          { id: '3', name: 'Qualified', key: 'qualified' },
        ];
        
        const priorities: LeadPriority[] = [
          { id: '1', name: 'Low', key: 'low' },
          { id: '2', name: 'Normal', key: 'normal' },
          { id: '3', name: 'High', key: 'high' },
        ];
        
        setLeadSources(sources);
        setLeadStatuses(statuses);
        setLeadPriorities(priorities);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lead settings');
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  if (loading) return <Card>Loading lead settings...</Card>;
  if (error) return <div className="error">Error: {error}</div>;

  const handleSave = async (e: Event) => {
    e.preventDefault();
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      alert('Lead settings saved!');
    } catch (err) {
      setError((err as Error).message);
      alert('Failed');
    }
  };

  return (
    <main className="settings-page">
      <div className="settings-container">
        <aside className="settings-sidebar">
          <h2>Lead Settings</h2>
        </aside>
        <section className="settings-main">
          <div className="breadcrumbs">
            <span>Leads</span>
          </div>
          <div className="settings-content">
            <h1>Lead Settings</h1>
            {error && <div className="error">Error: {error}</div>}
            <form onSubmit={handleSave} className="setting-form">
              <Card>
                <h3>Lead Sources</h3>
                {leadSources.map((s) => (
                  <div key={s.key} style={{ padding: 8, margin: 4, background: 'var(--card-background)', borderRadius: 6 }}>
                    <span>{s.name}</span>
                    <Button variant="ghost" size="mini">Remove</Button>
                  </div>
                ))}
              </Card>
              <Card>
                <h3>Lead Statuses</h3>
                {leadStatuses.map((s) => (
                  <div key={s.key} style={{ padding: 8, margin: 4, background: 'var(--card-background)', borderRadius: 6 }}>
                    <span>{s.name}</span>
                    <Button variant="ghost" size="mini">Remove</Button>
                  </div>
                ))}
              </Card>
              <Card>
                <h3>Lead Priorities</h3>
                {leadPriorities.map((p) => (
                  <div key={p.key} style={{ padding: 8, margin: 4, background: 'var(--card-background)', borderRadius: 6 }}>
                    <span>{p.name}</span>
                    <Button variant="ghost" size="mini">Remove</Button>
                  </div>
                ))}
              </Card>
            </form>
            <div className="button-group">
              <button>Save Settings</button>
              <button>Cancel</button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
