'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';
import { downloadCsv } from '../../../lib/csv';
import LeadCsvImport from './LeadCsvImport';

type LeadSource = 'website' | 'referral' | 'linkedin' | 'other';
type LeadStatus = 'new' | 'contacted' | 'qualified' | 'disqualified';
type Lead = { id: string; name: string; company: string; source: LeadSource; status: LeadStatus; owner: string; createdAt: string; updatedAt: string };
type LeadDraft = Pick<Lead, 'name' | 'company' | 'source' | 'status'>;
type LeadAssignee = { id: string; name: string };
type AssignmentPlan = {
  scope: 'selected' | 'all';
  assignedCount: number;
  assigneeCount: number;
  assignments: { leadId: string; name: string; currentOwner: string; ownerUserId: string; owner: string }[];
};

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
  const [canManageAssignments, setCanManageAssignments] = useState(false);
  const [canImportLeads, setCanImportLeads] = useState(false);
  const [showLeadCsvImport, setShowLeadCsvImport] = useState(false);
  const [assignees, setAssignees] = useState<LeadAssignee[]>([]);
  const [assignmentUserIds, setAssignmentUserIds] = useState<string[]>([]);
  const [autoAssignEnabled, setAutoAssignEnabled] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);
  const [assignmentPreview, setAssignmentPreview] = useState<AssignmentPlan | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadImportPermission() {
      try {
        const response = await crmApiFetch('/auth/me', { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (!Array.isArray(payload.organizations)) throw new Error('Could not verify workspace permissions for lead import.');
        let selectedOrganizationId = '';
        try {
          const saved = sessionStorage.getItem('myr.organization');
          const parsed = saved ? JSON.parse(saved) as { id?: unknown } : null;
          if (typeof parsed?.id === 'string') selectedOrganizationId = parsed.id;
        } catch { /* Ignore invalid cached organization data. */ }
        const organizations = payload.organizations as { id?: unknown; role?: unknown }[];
        const selected = organizations.find(({ id }) => id === selectedOrganizationId) ?? organizations[0];
        if (!controller.signal.aborted) {
          setCanImportLeads(selected?.role === 'owner' || selected?.role === 'admin');
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setCanImportLeads(false);
          setError(caught instanceof Error ? caught.message : 'Could not verify workspace permissions for lead import.');
        }
      }
    }
    void loadImportPermission();
    return () => controller.abort();
  }, [assignmentRefresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssignmentSettings() {
      try {
        const response = await crmApiFetch('/leads/assignment-settings');
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (cancelled) return;
        setCanManageAssignments(Boolean(payload.data?.canManage));
        const availableAssignees = Array.isArray(payload.data?.assignees) ? payload.data.assignees as LeadAssignee[] : [];
        const availableIds = new Set(availableAssignees.map((assignee) => assignee.id));
        setAssignees(availableAssignees);
        setAssignmentUserIds(Array.isArray(payload.data?.assigneeUserIds)
          ? (payload.data.assigneeUserIds as string[]).filter((id) => availableIds.has(id))
          : []);
        setAutoAssignEnabled(Boolean(payload.data?.enabled));
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load lead assignment settings.');
      }
    }
    void loadAssignmentSettings();
    return () => { cancelled = true; };
  }, [assignmentRefresh]);

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

  function toggleAssignee(userId: string) {
    setAssignmentPreview(null);
    setAssignmentUserIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  function toggleVisibleLeads() {
    setAssignmentPreview(null);
    const visibleIds = leads.map((lead) => lead.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedLeadIds.includes(id));
    setSelectedLeadIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  }

  async function saveAssignmentSettings() {
    setAssignmentBusy(true);
    setError('');
    try {
      const response = await crmApiFetch('/leads/assignment-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: autoAssignEnabled, assigneeUserIds: assignmentUserIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setNotice(autoAssignEnabled
        ? 'Round-robin assignment is on for new leads.'
        : 'Lead assignment settings saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save lead assignment settings.');
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function distributeLeads(scope: 'selected' | 'all') {
    setAssignmentBusy(true);
    setAssignmentPreview(null);
    setError('');
    try {
      const response = await crmApiFetch('/leads/distribute/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          assigneeUserIds: assignmentUserIds,
          ...(scope === 'selected' ? { leadIds: selectedLeadIds } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setAssignmentPreview(payload.data as AssignmentPlan);
      if (!payload.data?.assignedCount) setNotice('There are no active leads to distribute.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not preview lead distribution.');
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function applyDistribution() {
    if (!assignmentPreview) return;
    setAssignmentBusy(true);
    setError('');
    try {
      const response = await crmApiFetch('/leads/distribute', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: assignmentPreview.assignments.map(({ leadId, ownerUserId }) => ({ leadId, ownerUserId })) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      const assignedCount = Number(payload.data?.assignedCount ?? 0);
      setNotice(`${assignedCount} ${assignedCount === 1 ? 'lead was' : 'leads were'} assigned as previewed.`);
      setAssignmentPreview(null);
      setSelectedLeadIds([]);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not apply lead assignments.');
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function exportLeads() {
    setExporting(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (source) params.set('source', source);
      if (status) params.set('status', status);
      const [sortBy, sortOrder] = sort.split(':');
      params.set('sortBy', sortBy ?? 'createdAt');
      params.set('sortOrder', sortOrder ?? 'desc');
      const response = await crmApiFetch(`/leads/export${params.size ? `?${params}` : ''}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      const rows = (payload.data as Lead[]).map((lead) => [lead.name, lead.company, lead.source, lead.status, lead.owner, lead.createdAt]);
      downloadCsv('leads.csv', ['name', 'company', 'source', 'status', 'owner', 'created_at'], rows);
      setNotice(`${rows.length} leads exported using the current search and filters.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export leads.');
    } finally {
      setExporting(false);
    }
  }

  return <section className="leads-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / LEADS</p><h1>Leads</h1><p className="welcome-copy">Manage prospects from first touch to qualified opportunity.</p></div><div className="leads-header-actions">{canImportLeads && <button className="button button-secondary" type="button" aria-expanded={showLeadCsvImport} aria-controls="lead-csv-import" onClick={() => setShowLeadCsvImport((visible) => !visible)}>{showLeadCsvImport ? 'Close CSV import' : 'Import CSV'}</button>}<button className="button button-primary" type="button" onClick={() => setDialogLead(null)}><span aria-hidden="true">＋</span> Add lead</button></div></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.includes('sign in') || error.includes('token') || error.includes('Authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => { setRefresh((value) => value + 1); setAssignmentRefresh((value) => value + 1); }}>Retry</button>}</div>}
    {canManageAssignments && <section className="panel lead-assignment-panel" aria-label="Lead distribution">
      <div className="lead-assignment-heading"><div><strong>Lead distribution</strong><p>Split active leads evenly across your selected team members.</p></div><label className="lead-auto-assign-toggle"><input type="checkbox" checked={autoAssignEnabled} onChange={(event) => setAutoAssignEnabled(event.target.checked)} /> Automatically assign new leads (round-robin)</label></div>
      {assignees.length ? <div className="lead-assignment-members" role="group" aria-label="Team members to receive leads">
        {assignees.map((assignee) => <label key={assignee.id}><input type="checkbox" checked={assignmentUserIds.includes(assignee.id)} onChange={() => toggleAssignee(assignee.id)} />{assignee.name}</label>)}
      </div> : <p className="lead-assignment-empty">Add an active team member who can own leads to enable distribution.</p>}
      <div className="lead-assignment-actions">
        <span>{assignmentUserIds.length} team {assignmentUserIds.length === 1 ? 'member' : 'members'} selected · {selectedLeadIds.length} leads selected</span>
        <div>
          <button className="button button-secondary" type="button" onClick={() => void saveAssignmentSettings()} disabled={assignmentBusy || (autoAssignEnabled && !assignmentUserIds.length)}>Save auto-assignment</button>
          <button className="button button-secondary" type="button" onClick={() => void distributeLeads('selected')} disabled={assignmentBusy || !selectedLeadIds.length || !assignmentUserIds.length}>Distribute selected</button>
          <button className="button button-primary" type="button" onClick={() => void distributeLeads('all')} disabled={assignmentBusy || !assignmentUserIds.length}>Distribute all active</button>
          {selectedLeadIds.length > 0 && <button className="lead-clear-selection" type="button" onClick={() => setSelectedLeadIds([])} disabled={assignmentBusy}>Clear selection</button>}
        </div>
      </div>
    </section>}
    {canImportLeads && showLeadCsvImport && <section id="lead-csv-import" className="panel lead-csv-import-panel" aria-label="Lead CSV import">
      <div className="lead-assignment-heading"><div><strong>Lead CSV import</strong><p>Review and validate rows before adding leads. Existing records are never overwritten.</p></div></div>
      <LeadCsvImport compact onImported={(count) => { setNotice(`${count} leads were imported.`); setRefresh((value) => value + 1); }} />
    </section>}
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Lead directory</strong><span>{loading ? 'Updating leads…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'lead' : 'leads'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search leads…" aria-label="Search leads" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Filter by source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">All sources</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Sort leads" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="company:asc">Company A–Z</option></select><button className="button button-secondary" type="button" onClick={() => void exportLeads()} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button></div></section>
    {assignmentPreview && <section className="panel lead-assignment-preview" aria-label="Proposed lead assignments">
      <div className="lead-assignment-heading"><div><strong>Review proposed assignments</strong><p>{assignmentPreview.assignedCount} active leads will be distributed evenly across {assignmentPreview.assigneeCount} selected employees. No changes are applied until you confirm.</p></div><button className="lead-clear-selection" type="button" onClick={() => setAssignmentPreview(null)} disabled={assignmentBusy}>Cancel</button></div>
      <div className="lead-assignment-preview-list"><table><thead><tr><th>LEAD</th><th>CURRENT OWNER</th><th>PROPOSED OWNER</th></tr></thead><tbody>{assignmentPreview.assignments.map((assignment) => <tr key={assignment.leadId}><td>{assignment.name}</td><td>{assignment.currentOwner}</td><td>{assignment.owner}</td></tr>)}</tbody></table></div>
      <button className="button button-primary" type="button" onClick={() => void applyDistribution()} disabled={assignmentBusy || !assignmentPreview.assignments.length}>{assignmentBusy ? 'Applying…' : 'Apply proposed assignments'}</button>
    </section>}
    <section className="panel leads-table-panel"><div className="table-scroll"><table className="leads-table"><thead><tr>{canManageAssignments && <th><input type="checkbox" aria-label="Select all visible leads" checked={leads.length > 0 && leads.every((lead) => selectedLeadIds.includes(lead.id))} onChange={toggleVisibleLeads} /></th>}<th>LEAD</th><th>COMPANY</th><th>SOURCE</th><th>STATUS</th><th>OWNER</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !leads.length && Array.from({ length: 4 }, (_, index) => <tr className="lead-skeleton-row" key={`skeleton-${index}`}><td colSpan={canManageAssignments ? 7 : 6}><span /><span /><span /></td></tr>)}
      {!loading && leads.map((lead) => <tr key={lead.id}>{canManageAssignments && <td><input type="checkbox" aria-label={`Select ${lead.name}`} checked={selectedLeadIds.includes(lead.id)} onChange={() => { setAssignmentPreview(null); setSelectedLeadIds((current) => current.includes(lead.id) ? current.filter((id) => id !== lead.id) : [...current, lead.id]); }} /></td>}<td className="lead-name-cell"><span className="module-record-mark">{lead.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><strong>{lead.name}</strong></td><td>{lead.company}</td><td><span className={`lead-source-pill source-${lead.source}`}>{sourceLabels[lead.source]}</span></td><td><span className={`lead-status-pill status-${lead.status}`}>{statusLabels[lead.status]}</span></td><td><span className="avatar avatar-owner">{lead.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>{lead.owner}</td><td><div className="lead-row-actions"><button type="button" onClick={() => setDialogLead(lead)} aria-label={`Edit ${lead.name}`}>Edit</button><button type="button" onClick={() => void archive(lead)} aria-label={`Archive ${lead.name}`}>Archive</button></div></td></tr>)}
      {!loading && !error && !leads.length && <tr><td colSpan={canManageAssignments ? 7 : 6}><div className="leads-empty"><span className="leads-empty-icon">♙</span><strong>{query || source || status ? 'No matching leads' : 'No leads yet'}</strong><p>{query || source || status ? 'Try changing your search or filters.' : 'Add your first lead to start building your pipeline.'}</p>{!query && !source && !status && <button className="button button-primary" type="button" onClick={() => setDialogLead(null)}>Add a lead</button>}</div></td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>{loading ? 'Loading leads' : `Showing ${leads.length} of ${pageInfo.total} leads`}</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.max(1, pageInfo.totalPages)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogLead !== undefined && <LeadDialog lead={dialogLead} onClose={() => setDialogLead(undefined)} onSaved={saved} />}
  </section>;
}
