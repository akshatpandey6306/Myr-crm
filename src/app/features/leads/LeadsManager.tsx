'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';

type LeadSource = 'website' | 'referral' | 'linkedin' | 'other';
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'disqualified';
type Lead = { id: string; name: string; company: string; source: LeadSource; status: LeadStatus; owner: string; createdAt: string; updatedAt: string };
type LeadDraft = Pick<Lead, 'name' | 'company' | 'source' | 'status'>;

const sourceLabels: Record<LeadSource, string> = { website: 'Website', referral: 'Referral', linkedin: 'LinkedIn', other: 'Other' };
const statusLabels: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', disqualified: 'Disqualified' };

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const error = payload as { error?: { message?: unknown }; message?: unknown };
  const message = error.error?.message ?? error.message;
  return typeof message === 'string' ? message : 'Something went wrong. Please try again.';
}

function LeadDialog({ lead, onClose, onSaved }: { lead: Lead | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: LeadDraft = {
      name: String(form.get('name') ?? '').trim(),
      company: String(form.get('company') ?? '').trim(),
      source: String(form.get('source') ?? 'website') as LeadSource,
      status: String(form.get('status') ?? 'new') as LeadStatus,
    };
    setBusy(true);
    setError('');
    try {
      const response = await crmApiFetch(lead ? `/leads/${lead.id}` : '/leads', {
        method: lead ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error && caught.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : caught instanceof Error ? caught.message : 'Could not save this lead.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="record-dialog lead-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-dialog-title"><header><div><span className="auth-step">LEAD DETAILS</span><h2 id="lead-dialog-title">{lead ? 'Edit lead' : 'Add a lead'}</h2><p>Keep the prospect details up to date.</p></div><button type="button" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields"><label>Name <span>required</span><input name="name" defaultValue={lead?.name ?? ''} autoFocus required maxLength={120} placeholder="e.g. Olivia Rhye" /></label><label>Company <span>required</span><input name="company" defaultValue={lead?.company ?? ''} required maxLength={160} placeholder="e.g. Northstar Labs" /></label><label>Source<select name="source" defaultValue={lead?.source ?? 'website'}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Status<select name="status" defaultValue={lead?.status ?? 'new'}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : lead ? 'Save changes' : 'Create lead'}</button></footer></form></section></div>;
}

export default function LeadsManager() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogLead, setDialogLead] = useState<Lead | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (source) params.set('source', source);
      if (status) params.set('status', status);
      params.set('page', String(page)); params.set('pageSize', '25');
      const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
      try {
        const response = await crmApiFetch(`/leads${params.size ? `?${params.toString()}` : ''}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (!cancelled) { setLeads(Array.isArray(payload.data) ? payload.data as Lead[] : []); setPageInfo({ total: payload.meta?.total ?? 0, totalPages: payload.meta?.totalPages ?? 0 }); }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === 'AbortError')) return;
        setError(caught instanceof Error && caught.message.includes('fetch') ? 'Could not reach the CRM API. Start the API server and try again.' : caught instanceof Error ? caught.message : 'Could not load leads.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, source, status, refresh, page, sort]);

  async function archive(lead: Lead) {
    if (!window.confirm(`Archive ${lead.name}? It will be removed from the active lead list.`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/leads/${lead.id}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setNotice(`${lead.name} was archived.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not archive this lead.');
    }
  }

  function saved() {
    const editing = Boolean(dialogLead);
    setDialogLead(undefined);
    setNotice(editing ? 'Lead changes saved.' : 'Lead created.');
    setRefresh((value) => value + 1);
  }

  return <section className="leads-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / LEADS</p><h1>Leads</h1><p className="welcome-copy">Manage prospects from first touch to qualified opportunity.</p></div><button className="button button-primary" type="button" onClick={() => setDialogLead(null)}><span aria-hidden="true">＋</span> Add lead</button></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.includes('sign in') || error.includes('token') || error.includes('Authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Lead directory</strong><span>{loading ? 'Updating leads…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'lead' : 'leads'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search leads…" aria-label="Search leads" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Filter by source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">All sources</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Sort leads" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="company:asc">Company A–Z</option></select></div></section>
    <section className="panel leads-table-panel"><div className="table-scroll"><table className="leads-table"><thead><tr><th>LEAD</th><th>COMPANY</th><th>SOURCE</th><th>STATUS</th><th>OWNER</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !leads.length && Array.from({ length: 4 }, (_, index) => <tr className="lead-skeleton-row" key={`skeleton-${index}`}><td colSpan={6}><span /><span /><span /></td></tr>)}
      {!loading && leads.map((lead) => <tr key={lead.id}><td className="lead-name-cell"><span className="module-record-mark">{lead.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><strong>{lead.name}</strong></td><td>{lead.company}</td><td><span className={`lead-source-pill source-${lead.source}`}>{sourceLabels[lead.source]}</span></td><td><span className={`lead-status-pill status-${lead.status}`}>{statusLabels[lead.status]}</span></td><td><span className="avatar avatar-owner">{lead.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>{lead.owner}</td><td><div className="lead-row-actions"><button type="button" onClick={() => setDialogLead(lead)} aria-label={`Edit ${lead.name}`}>Edit</button><button type="button" onClick={() => void archive(lead)} aria-label={`Archive ${lead.name}`}>Archive</button></div></td></tr>)}
      {!loading && !error && !leads.length && <tr><td colSpan={6}><div className="leads-empty"><span className="leads-empty-icon">♙</span><strong>{query || source || status ? 'No matching leads' : 'No leads yet'}</strong><p>{query || source || status ? 'Try changing your search or filters.' : 'Add your first lead to start building your pipeline.'}</p>{!query && !source && !status && <button className="button button-primary" type="button" onClick={() => setDialogLead(null)}>Add a lead</button>}</div></td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>{loading ? 'Loading leads' : `Showing ${leads.length} of ${pageInfo.total} leads`}</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.max(1, pageInfo.totalPages)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogLead !== undefined && <LeadDialog lead={dialogLead} onClose={() => setDialogLead(undefined)} onSaved={saved} />}
  </section>;
}
