'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from '../SettingsPanels.module.css';

type Assignee = { id: string; name: string };
type Settings = { canManage: boolean; enabled: boolean; assigneeUserIds: string[]; assignees: Assignee[] };
type Distribution = { label: string; value: number };

const sourceNames = ['facebook', 'instagram', 'meta_ads', 'google', 'linkedin', 'referral', 'website', 'other'];
const statusNames = ['new', 'contacted', 'qualified', 'disqualified'];
const nice = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function LeadSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bySource, setBySource] = useState<Distribution[]>([]);
  const [byStatus, setByStatus] = useState<Distribution[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [assignmentResponse, analyticsResponse] = await Promise.all([
        crmApiFetch('/leads/assignment-settings'),
        crmApiFetch('/leads/analytics'),
      ]);
      const [assignment, analytics] = await Promise.all([assignmentResponse.json(), analyticsResponse.json()]);
      if (!assignmentResponse.ok) throw new Error(assignment?.error?.message ?? 'Could not load lead settings.');
      if (!analyticsResponse.ok) throw new Error(analytics?.error?.message ?? 'Could not load lead analytics.');
      const value = assignment.data as Settings;
      setSettings(value);
      setEnabled(value.enabled);
      setAssigneeIds(value.assigneeUserIds ?? []);
      setBySource(analytics.data?.bySource ?? []);
      setByStatus(analytics.data?.byStatus ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load lead settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refresh]);

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await crmApiFetch('/leads/assignment-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, assigneeUserIds: assigneeIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save lead assignment settings.');
      setNotice(enabled ? 'Automatic lead assignment is enabled.' : 'Lead assignment settings saved.');
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save lead assignment settings.');
    } finally {
      setSaving(false);
    }
  }

  function toggleAssignee(id: string) {
    setAssigneeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const activeSources = sourceNames.map((name) => ({ name, count: bySource.find((item) => item.label === name)?.value ?? 0 }));
  const activeStatuses = statusNames.map((name) => ({ name, count: byStatus.find((item) => item.label === name)?.value ?? 0 }));

  return <main className={styles.page}>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>WORKSPACE / LEAD SETTINGS</span><h2>Lead operations</h2><p>Control how new leads are shared and review the pipeline categories in use.</p></div><Link className={styles.primaryLink} href="/leads">Open leads <span aria-hidden="true">↗</span></Link></header>
    {error && <div className={styles.error} role="alert"><div><strong>Lead settings couldn’t load</strong><span>{error}</span></div><button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <section className={styles.metrics} aria-label="Lead pipeline summary">
      <article><span>Lead sources</span><strong>{activeSources.length}</strong><small>Built-in workspace sources</small></article>
      <article><span>Lead stages</span><strong>{activeStatuses.length}</strong><small>Used by filters and follow-ups</small></article>
      <article><span>Auto assignment</span><strong>{enabled ? 'On' : 'Off'}</strong><small>{assigneeIds.length} team members selected</small></article>
    </section>
    <div className={styles.leadGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>NEW LEADS</span><h3>Automatic assignment</h3><p>Share newly created leads across selected active teammates.</p></div><label className={styles.switch}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={loading || saving || !settings?.canManage} /><span /><b>{enabled ? 'On' : 'Off'}</b></label></div>
        {loading ? <p className={styles.muted}>Loading available teammates…</p> : settings?.assignees.length ? <div className={styles.assigneeGrid}>{settings.assignees.map((person) => <label className={styles.assignee} key={person.id}><input type="checkbox" checked={assigneeIds.includes(person.id)} onChange={() => toggleAssignee(person.id)} disabled={saving || !settings.canManage} /><span className={styles.avatar}>{person.name.slice(0, 1).toUpperCase()}</span><span><strong>{person.name}</strong><small>Lead assignee</small></span></label>)}</div> : <p className={styles.empty}>{settings?.canManage ? 'Add teammates in Team to configure lead assignment.' : 'Workspace admins manage automatic assignment.'}</p>}
        <div className={styles.panelFooter}><span>{settings?.canManage ? 'Changes apply to new leads.' : 'Only workspace admins can change assignment.'}</span><button type="button" onClick={() => void save()} disabled={loading || saving || !settings?.canManage || (enabled && assigneeIds.length === 0)}>{saving ? 'Saving…' : 'Save assignment'}</button></div>
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>CHANNEL ATTRIBUTION</span><h3>Lead sources</h3><p>Track where workspace leads came from. Source data is isolated to this workspace.</p></div></div>
        <div className={styles.distribution}>{activeSources.map(({ name, count }) => <div className={styles.distributionRow} key={name}><span>{nice(name)}</span><div><i style={{ width: `${Math.min(count * 12, 100)}%` }} /></div><strong>{count}</strong></div>)}</div>
        <Link className={styles.secondaryLink} href="/leads">View source filters <span aria-hidden="true">↗</span></Link>
      </section>
      <section className={`${styles.panel} ${styles.statusPanel}`}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>LEAD JOURNEY</span><h3>Status stages</h3><p>Track progress from first contact through qualification.</p></div></div>
        <div className={styles.statusStages}>{activeStatuses.map(({ name, count }, index) => <div key={name}><span className={styles.stageNumber}>{String(index + 1).padStart(2, '0')}</span><span><strong>{nice(name)}</strong><small>{count} {count === 1 ? 'lead' : 'leads'}</small></span><i style={{ width: `${Math.max(8, Math.min(count * 10, 100))}%` }} /></div>)}</div>
      </section>
    </div>
  </main>;
}
