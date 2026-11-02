'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from './ReportsManager.module.css';

type Summary = {
  generatedAt: string;
  metrics: {
    totalLeads: number;
    openDeals: number;
    openPipelineValue: string;
    wonRevenue: string;
    openActivities: number;
    completedActivities: number;
  };
  leadsByStatus: Array<{ status: string; count: number }>;
  dealsByStatus: Array<{ status: string; count: number; value: string }>;
  activitiesByStatus: Array<{ status: string; count: number }>;
};

type CurrencyCode = 'USD' | 'CAD' | 'EUR' | 'GBP';

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const message = result.error?.message ?? result.message;
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.';
}

function currency(value: string, currencyCode: CurrencyCode) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function label(value: string) {
  return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function ReportsManager() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [currencyCode, setCurrencyCode] = useState<CurrencyCode>('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [reportResponse, settingsResponse] = await Promise.all([
          crmApiFetch('/reports/summary', { signal: controller.signal }),
          crmApiFetch('/settings', { signal: controller.signal }),
        ]);
        const [reportPayload, settingsPayload] = await Promise.all([
          reportResponse.json(),
          settingsResponse.json(),
        ]);
        if (!reportResponse.ok) throw new Error(errorMessage(reportPayload));
        if (!settingsResponse.ok) throw new Error(errorMessage(settingsPayload));
        const settings = settingsPayload && typeof settingsPayload === 'object' && 'data' in settingsPayload
          ? settingsPayload.data as { currency?: unknown }
          : null;
        if (!settings || !['USD', 'CAD', 'EUR', 'GBP'].includes(String(settings.currency))) {
          throw new Error('The CRM API returned an invalid workspace currency.');
        }
        if (active) {
          setSummary(reportPayload.data as Summary);
          setCurrencyCode(settings.currency as CurrencyCode);
        }
      } catch (cause) {
        if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch')
          ? 'Could not reach the CRM API. Start the API server and try again.'
          : cause instanceof Error ? cause.message : 'Could not load reports.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [refresh]);

  const maximum = Math.max(
    1,
    ...(summary?.leadsByStatus.map((item) => item.count) ?? []),
    ...(summary?.dealsByStatus.map((item) => item.count) ?? []),
    ...(summary?.activitiesByStatus.map((item) => item.count) ?? []),
  );

  function reportRows<T extends { status: string; count: number }>(items: T[], value?: (item: T) => string) {
    if (!items.length) return <p className={styles.empty}>No active records yet.</p>;
    return <ul className={styles.breakdown}>{items.map((item) => <li key={item.status}>
      <div className={styles.rowLabel}><span>{label(item.status)}</span><strong>{item.count}{value ? ` · ${value(item)}` : ''}</strong></div>
      <div className={styles.track} role="progressbar" aria-label={`${label(item.status)} count`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={item.count}>
        <span style={{ width: `${Math.min(100, item.count / maximum * 100)}%` }} />
      </div>
    </li>)}</ul>;
  }

  const metrics = summary?.metrics;

  return <section className={styles.feature}>
    <header className={styles.heading}>
      <div><p className="date-label">WORKSPACE / REPORTS</p><h1>Reports</h1><p className="welcome-copy">A live view of pipeline, lead, and team activity.</p></div>
      <button className="button button-secondary" type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading} aria-label="Refresh reports">↻ Refresh</button>
    </header>
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <div className={styles.metricGrid} aria-label="Workspace report metrics" aria-busy={loading}>
      <article className={styles.metric}><span>Open pipeline</span><strong>{loading ? '...' : currency(metrics?.openPipelineValue ?? '0', currencyCode)}</strong><small>{metrics?.openDeals ?? 0} open deals</small></article>
      <article className={styles.metric}><span>Won revenue</span><strong>{loading ? '...' : currency(metrics?.wonRevenue ?? '0', currencyCode)}</strong><small>From won deals</small></article>
      <article className={styles.metric}><span>Active leads</span><strong>{loading ? '...' : metrics?.totalLeads ?? 0}</strong><small>Across all lead statuses</small></article>
      <article className={styles.metric}><span>Open activities</span><strong>{loading ? '...' : metrics?.openActivities ?? 0}</strong><small>Open or in progress</small></article>
      <article className={styles.metric}><span>Completed activities</span><strong>{loading ? '...' : metrics?.completedActivities ?? 0}</strong><small>Marked completed</small></article>
    </div>
    <div className={styles.reportGrid} aria-busy={loading}>
      <section className={styles.reportPanel} aria-labelledby="lead-breakdown-title"><div className={styles.panelHeading}><div><p>ACQUISITION</p><h2 id="lead-breakdown-title">Lead status</h2></div><span>LEADS</span></div>{loading ? <p className={styles.empty}>Loading report...</p> : reportRows(summary?.leadsByStatus ?? [])}</section>
      <section className={styles.reportPanel} aria-labelledby="deal-breakdown-title"><div className={styles.panelHeading}><div><p>PIPELINE</p><h2 id="deal-breakdown-title">Deal outcomes</h2></div><span>DEALS</span></div>{loading ? <p className={styles.empty}>Loading report...</p> : reportRows(summary?.dealsByStatus ?? [], (item) => currency(item.value, currencyCode))}</section>
      <section className={styles.reportPanel} aria-labelledby="activity-breakdown-title"><div className={styles.panelHeading}><div><p>TEAM WORKLOAD</p><h2 id="activity-breakdown-title">Activity status</h2></div><span>ACTIVITIES</span></div>{loading ? <p className={styles.empty}>Loading report...</p> : reportRows(summary?.activitiesByStatus ?? [])}</section>
    </div>
    {summary?.generatedAt && <p className={styles.timestamp}>Updated {new Date(summary.generatedAt).toLocaleString()}</p>}
  </section>;
}
