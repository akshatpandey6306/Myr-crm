'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import styles from './AuditLogsManager.module.css';

type AuditEvent = {
  id: string;
  action: 'create' | 'update' | 'archive';
  resourceType: string;
  resourceId: string | null;
  actorUserId: string;
  actorName: string;
  createdAt: string;
};

type AuditFilters = { action: string; resourceType: string; actor: string; from: string; to: string };
const emptyFilters: AuditFilters = { action: '', resourceType: '', actor: '', from: '', to: '' };

function localDateBoundary(value: string, nextDay = false) {
  const date = new Date(`${value}T00:00:00`);
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const message = result.error?.message ?? result.message;
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.';
}

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AuditLogsManager() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters);
  const [activeFilters, setActiveFilters] = useState<AuditFilters>(emptyFilters);
  const [filterError, setFilterError] = useState('');
  const pageSize = 25;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (activeFilters.action) params.set('action', activeFilters.action);
        if (activeFilters.resourceType.trim()) params.set('resourceType', activeFilters.resourceType.trim());
        if (activeFilters.actor.trim()) params.set('actor', activeFilters.actor.trim());
        if (activeFilters.from) params.set('from', localDateBoundary(activeFilters.from));
        if (activeFilters.to) params.set('to', localDateBoundary(activeFilters.to, true));
        const response = await crmApiFetch(`/audit-logs?${params}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (active) {
          setEvents(Array.isArray(payload.data) ? payload.data as AuditEvent[] : []);
          setTotal(Number(payload.meta?.total) || 0);
        }
      } catch (cause) {
        if (!active || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch')
          ? 'Could not reach the CRM API. Start the API server and try again.'
          : cause instanceof Error ? cause.message : 'Could not load audit history.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [page, refresh, activeFilters]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filters.from && filters.to && filters.from > filters.to) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }
    setFilterError('');
    setPage(1);
    setActiveFilters({ ...filters });
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setActiveFilters(emptyFilters);
    setFilterError('');
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return <section className={styles.feature}>
    <header className={styles.heading}>
      <div><p className="date-label">WORKSPACE / AUDIT LOGS</p><h1>Audit Logs</h1><p className="welcome-copy">A record of workspace changes and who made them.</p></div>
      <button className="button button-secondary" type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading} aria-label="Refresh audit logs">↻ Refresh</button>
    </header>
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('role') || error.toLowerCase().includes('manager') ? <Link href="/">Return to workspace</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className={styles.panel} aria-label="Workspace audit history" aria-busy={loading}>
      <div className={styles.panelHeading}><div><h2>Recent changes</h2><p>{loading ? 'Updating history...' : `${total.toLocaleString()} recorded events`}</p></div></div>
      <form className={styles.filters} onSubmit={applyFilters}>
        <label>Action<select value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}><option value="">All actions</option><option value="create">Created</option><option value="update">Updated</option><option value="archive">Archived</option></select></label>
        <label>Record type<input value={filters.resourceType} onChange={(event) => setFilters((current) => ({ ...current, resourceType: event.target.value }))} placeholder="e.g. deals" maxLength={48} /></label>
        <label>Actor<input value={filters.actor} onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))} placeholder="Search by name" maxLength={120} /></label>
        <label>From<input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label>To<input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        <div className={styles.filterActions}><button className="button button-primary" type="submit" disabled={loading}>Apply filters</button><button className="button button-secondary" type="button" onClick={clearFilters} disabled={loading}>Clear</button></div>
        {filterError && <p className={styles.filterError} role="alert">{filterError}</p>}
      </form>
      <div className={styles.tableScroll}><table>
        <thead><tr><th>ACTOR</th><th>ACTION</th><th>RECORD</th><th>RECORD ID</th><th>WHEN</th></tr></thead>
        <tbody>
          {!loading && events.map((event) => <tr key={event.id}>
            <td className={styles.actor}>{event.actorName}</td>
            <td><span className={`${styles.action} ${styles[event.action]}`}>{title(event.action)}</span></td>
            <td>{title(event.resourceType)}</td>
            <td className={styles.recordId}>{event.resourceId ?? '—'}</td>
            <td>{new Date(event.createdAt).toLocaleString()}</td>
          </tr>)}
          {!loading && !events.length && !error && <tr><td className={styles.empty} colSpan={5}>No audit events have been recorded yet.</td></tr>}
          {loading && <tr><td className={styles.empty} colSpan={5}>Loading audit history...</td></tr>}
        </tbody>
      </table></div>
      <footer className={styles.footer}><span>Page {page} of {totalPages}</span><div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page === 1} aria-label="Previous audit log page">‹</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={loading || page >= totalPages} aria-label="Next audit log page">›</button></div></footer>
    </section>
  </section>;
}
