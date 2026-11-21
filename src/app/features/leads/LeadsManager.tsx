'use client';

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';
import { downloadCsv } from '../../../lib/csv';
import LeadCsvImport from './LeadCsvImport';
import RadialBarChart from '../../components/RadialBarChart';
import PieBarChart from '../../components/PieBarChart';
import type { DistributionDatum } from '../../components/chart-types';

type LeadSource = 'website' | 'facebook' | 'instagram' | 'meta_ads' | 'google' | 'referral' | 'linkedin' | 'other';
type Lead = { id: string; name: string; company: string; phone?: string; email?: string; source: LeadSource; status: string; owner: string; ownerRole?: string; ownerUserId?: string; createdAt: string; updatedAt: string };
type LeadDraft = Pick<Lead, 'name' | 'company' | 'source' | 'status' | 'phone' | 'email'>;
type LeadAssignee = { id: string; name: string };
type AssignmentPlan = {
  scope: 'selected' | 'all';
  assignedCount: number;
  assigneeCount: number;
  assignments: { leadId: string; name: string; currentOwner: string; ownerUserId: string; owner: string }[];
};

const sourceLabels: Record<LeadSource, string> = { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', meta_ads: 'Meta Ads', google: 'Google', referral: 'Referral', linkedin: 'LinkedIn', other: 'Other' };
const statusLabels: Record<string, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', disqualified: 'Disqualified' };
const customStatusOption = '__custom_status__';

function statusLabel(status: string) {
  if (Object.prototype.hasOwnProperty.call(statusLabels, status)) return statusLabels[status]!;
  return status.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string) {
  return `lead-status-pill ${Object.prototype.hasOwnProperty.call(statusLabels, status) ? `status-${status}` : 'status-custom'}`;
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const error = payload as { error?: { message?: unknown; details?: { duplicates?: unknown; companies?: unknown; contacts?: unknown } }; message?: unknown };
  const message = error.error?.message ?? error.message;
  const matches = [error.error?.details?.duplicates, error.error?.details?.companies, error.error?.details?.contacts].flatMap((items) => Array.isArray(items) ? items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as { name?: unknown; company?: unknown; email?: unknown };
    return typeof record.name === 'string' ? [`${record.name}${typeof record.company === 'string' ? ` (${record.company})` : typeof record.email === 'string' ? ` (${record.email})` : ''}`] : [];
  }) : []);
  return `${typeof message === 'string' ? message : 'Something went wrong. Please try again.'}${matches.length ? ` Matches: ${matches.join(', ')}.` : ''}`;
}

function LeadStatusField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isPreset = Object.prototype.hasOwnProperty.call(statusLabels, value);
  return <label className="lead-status-field">Status
    <select value={isPreset ? value : customStatusOption} onChange={(event) => onChange(event.target.value === customStatusOption ? '' : event.target.value)}>
      {Object.entries(statusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
      <option value={customStatusOption}>Custom status…</option>
    </select>
    {!isPreset && <input aria-label="Custom lead status" value={value} onChange={(event) => onChange(event.target.value)} maxLength={48} required placeholder="Type a status" />}
  </label>;
}

function LeadDialog({ lead, onClose, onSaved }: { lead: Lead | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(lead?.status ?? 'new');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!status.trim()) {
      setError('Enter a lead status.');
      return;
    }
    const body: LeadDraft = {
      name: String(form.get('name') ?? '').trim(),
      company: String(form.get('company') ?? '').trim(),
      email: String(form.get('email') ?? '').trim() || undefined,
      phone: String(form.get('phone') ?? '').trim() || undefined,
      source: String(form.get('source') ?? 'website') as LeadSource,
      status: status.trim(),
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

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="record-dialog lead-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-dialog-title"><header><div><span className="auth-step">LEAD DETAILS</span><h2 id="lead-dialog-title">{lead ? 'Edit lead' : 'Add a lead'}</h2><p>Keep the prospect details up to date.</p></div><button type="button" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields"><label>Name <span>required</span><input name="name" defaultValue={lead?.name ?? ''} autoFocus required maxLength={120} placeholder="e.g. Olivia Rhye" /></label><label>Company <span>required</span><input name="company" defaultValue={lead?.company ?? ''} required maxLength={160} placeholder="e.g. Northstar Labs" /></label><label>Work email<input name="email" type="email" defaultValue={lead?.email ?? ''} maxLength={254} placeholder="name@company.com" /></label><label>Phone<input name="phone" type="tel" defaultValue={lead?.phone ?? ''} maxLength={40} placeholder="+1 555 010 0123" /></label><label>Source<select name="source" defaultValue={lead?.source ?? 'website'}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><LeadStatusField value={status} onChange={setStatus} /></div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : lead ? 'Save changes' : 'Create lead'}</button></footer></form></section></div>;
}

type LeadActivity = { id: string; type: string; title: string; description: string | null; status: string; priority: string; dueAt: string | null; createdAt: string; createdBy: string; assignedTo: string | null; call: { status: string; durationSeconds: number | null; customerResponse: string | null; nextAction: string | null; followUpAt: string | null } | null };
type LeadConversion = { id: string; convertedAt: string; company: { id: string; name: string }; contact: { id: string; name: string; email: string }; deal: { id: string; name: string } | null; alreadyConverted?: boolean };
type LeadConversionOptions = { companies: { id: string; name: string }[]; contacts: { id: string; name: string; email: string }[]; canCreateDeal: boolean };
type LeadDetail = Lead & { phone: string; email: string; state: string; city: string; address: string; staffCount: number | null; productRequirement: string; demoType: string; demoAt: string | null; remarks: string; followUpAt: string | null; conversion: LeadConversion | null; calls: { id: string; callStatus: string; durationSeconds: number | null; customerResponse: string | null; nextAction: string | null; followUpAt: string | null; calledAt: string; loggedBy: string }[]; activities: LeadActivity[] };
function dateTimeInput(value: string | null) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function LeadDetailDialog({ lead, assignees, canAssign, onClose, onSaved, onArchive }: { lead: Lead; assignees: LeadAssignee[]; canAssign: boolean; onClose: () => void; onSaved: () => void; onArchive: () => void }) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activityBusy, setActivityBusy] = useState(false);
  const [conversionOptions, setConversionOptions] = useState<LeadConversionOptions | null>(null);
  const [conversionOpen, setConversionOpen] = useState(false);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionQuery, setConversionQuery] = useState('');
  useEffect(() => { let active = true; void crmApiFetch(`/leads/${lead.id}`).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); if (active) setDetail(payload.data as LeadDetail); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load lead details.'); }); return () => { active = false; }; }, [lead.id]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return; const form = new FormData(event.currentTarget); setBusy(true); setError(''); setMessage('');
    const body: Record<string, unknown> = Object.fromEntries(['name','company','phone','email','state','city','address','staffCount','productRequirement','demoType','demoAt','remarks','followUpAt'].map((key) => [key, String(form.get(key) ?? '').trim() || null]));
    if (!detail.status.trim()) { setError('Enter a lead status.'); setBusy(false); return; }
    body.status = detail.status.trim();
    body.staffCount = body.staffCount === null ? null : Number(body.staffCount);
    for (const key of ['demoAt','followUpAt']) body[key] = body[key] ? new Date(String(body[key])).toISOString() : null;
    try { const response = await crmApiFetch(`/leads/${lead.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); setDetail((current) => current ? { ...current, ...payload.data } : current); setMessage('Lead details saved.'); onSaved(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save lead details.'); } finally { setBusy(false); }
  }
  async function logCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const duration = String(form.get('duration') ?? '').trim(); const match = /^(\d{1,3}):([0-5]\d)$/.exec(duration); if (duration && !match) { setError('Enter call duration as minutes:seconds, such as 03:20.'); return; }
    setBusy(true); setError(''); const followUp = String(form.get('callFollowUp') ?? '');
    try { const response = await crmApiFetch(`/leads/${lead.id}/calls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callStatus: form.get('callStatus'), durationSeconds: match ? Number(match[1]) * 60 + Number(match[2]) : null, followUpAt: followUp ? new Date(followUp).toISOString() : null, customerResponse: form.get('customerResponse'), nextAction: form.get('nextAction') }) }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); setDetail((current) => current ? { ...current, calls: [payload.data, ...current.calls], activities: payload.data.activity ? [payload.data.activity, ...current.activities] : current.activities, followUpAt: payload.data.followUpAt ?? current.followUpAt } : current); event.currentTarget.reset(); setMessage('Call logged and added to the shared activity timeline.'); onSaved(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not log the call.'); } finally { setBusy(false); }
  }
  async function createLeadActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('activityTitle') ?? '').trim();
    if (!title) { setError('Enter a title for this activity.'); return; }
    const dueAt = String(form.get('activityDueAt') ?? '');
    setActivityBusy(true); setError('');
    try {
      const response = await crmApiFetch('/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        title,
        type: String(form.get('activityType') ?? 'task'),
        description: String(form.get('activityDescription') ?? '').trim() || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        priority: String(form.get('activityPriority') ?? 'normal'),
        status: 'open',
        relatedToType: 'lead',
        relatedToId: lead.id,
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      const created = payload.data as LeadActivity;
      setDetail((current) => current ? { ...current, activities: [created, ...current.activities] } : current);
      event.currentTarget.reset(); setMessage('Activity saved to the shared Activities module and this lead timeline.'); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create this activity.'); }
    finally { setActivityBusy(false); }
  }
  async function assign(event: ChangeEvent<HTMLSelectElement>) { const ownerUserId = event.target.value; if (!ownerUserId) return; setBusy(true); setError(''); try { const response = await crmApiFetch('/leads/distribute', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignments: [{ leadId: lead.id, ownerUserId }] }) }); const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); setMessage('Lead reassigned.'); onSaved(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not assign the lead.'); } finally { setBusy(false); } }
  async function loadConversionOptions(query = '') {
    setConversionBusy(true); setError('');
    try {
      const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
      const response = await crmApiFetch(`/leads/${lead.id}/conversion-options${suffix}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setConversionOptions(payload.data as LeadConversionOptions);
      setConversionOpen(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load conversion options.'); }
    finally { setConversionBusy(false); }
  }
  async function openConversion() { setConversionQuery(''); await loadConversionOptions(); }
  async function convertLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setConversionBusy(true); setError('');
    try {
      const response = await crmApiFetch(`/leads/${lead.id}/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: String(form.get('companyId') ?? '') || null, contactId: String(form.get('contactId') ?? '') || null, createDeal: form.get('createDeal') === 'on' }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setDetail((current) => current ? { ...current, conversion: payload.data as LeadConversion } : current);
      setConversionOpen(false); setMessage('Lead converted. Its history remains attached to the original lead.'); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not convert this lead.'); }
    finally { setConversionBusy(false); }
  }
  function createInvoice() {
    if (!detail) return;
    try {
      sessionStorage.setItem('myr.billing.invoicePrefill', JSON.stringify({
        customerName: detail.name,
        customerEmail: detail.email || null,
        customerPhone: detail.phone || null,
        billingAddress: detail.address || null,
      }));
      window.location.assign('/billing-invoicing?newInvoice=1');
    } catch {
      setError('Could not start an invoice from this lead. Please allow session storage and try again.');
    }
  }
  return <div className="dialog-backdrop lead-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="lead-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="lead-detail-title"><header className="lead-detail-heading"><div><span className="auth-step">LEAD #{lead.id.slice(0, 8)}</span><h2 id="lead-detail-title">{detail?.company ?? lead.company}</h2><p>{detail?.name ?? lead.name}</p></div><button type="button" aria-label="Close lead details" onClick={onClose}>×</button></header>{!detail ? <p className="lead-detail-loading">{error || 'Loading lead details…'}</p> : <form onSubmit={save}><div className="lead-detail-fields">
    <label>Company Name<input name="company" defaultValue={detail.company} /></label><label>Client Name<input name="name" defaultValue={detail.name} required /></label><label>Mobile Number<input name="phone" defaultValue={detail.phone} type="tel" /></label><label>Email<input name="email" defaultValue={detail.email} type="email" /></label>
    <label>State<input name="state" defaultValue={detail.state} /></label><label>City<input name="city" defaultValue={detail.city} /></label><label>Address<textarea name="address" defaultValue={detail.address} /></label><label>Staff Count<input name="staffCount" type="number" min="0" defaultValue={detail.staffCount ?? ''} /></label>
    <label>Product Requirement<textarea name="productRequirement" defaultValue={detail.productRequirement} /></label><label>Demo Type<input name="demoType" defaultValue={detail.demoType} /></label><label>Demo Date &amp; Time<input name="demoAt" type="datetime-local" defaultValue={dateTimeInput(detail.demoAt)} /></label><LeadStatusField value={detail.status} onChange={(status) => setDetail((current) => current ? { ...current, status } : current)} />
    <label>Remarks<textarea name="remarks" defaultValue={detail.remarks} /></label><label>Follow-up<input name="followUpAt" type="datetime-local" defaultValue={dateTimeInput(detail.followUpAt)} /></label>
  </div><div className="lead-detail-actions"><button className="button button-primary" type="submit" disabled={busy}>Save Changes</button>{!detail.conversion && <button className="button button-secondary" type="button" onClick={() => void openConversion()} disabled={conversionBusy}>{conversionBusy ? 'Loading…' : 'Convert lead'}</button>}<button className="button button-secondary" type="button" onClick={createInvoice} disabled={busy}>Create invoice</button><a className="button button-secondary" href={detail.phone ? `tel:${detail.phone}` : undefined} aria-disabled={!detail.phone}>☎ Call Customer</a><button className="button button-secondary" type="button" onClick={() => { document.querySelector<HTMLInputElement>('[name="demoAt"]')?.focus(); }}>▦ Book Demo / Field Visit</button><a className="button button-secondary" href={detail.phone ? `https://wa.me/${detail.phone.replace(/\D/g, '')}` : undefined} target="_blank" rel="noreferrer" aria-disabled={!detail.phone}>WhatsApp</a>{canAssign && <label className="lead-transfer">Assign / Transfer<select value="" onChange={(event) => void assign(event)} disabled={busy}><option value="">{detail.ownerRole === 'owner' ? 'Select team member' : detail.owner}</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}<button className="button button-danger" type="button" onClick={onArchive}>Delete Lead</button></div>
  {error && <p className="lead-form-error" role="alert">{error}</p>}{message && <p className="lead-detail-success" role="status">{message}</p>}</form>}
  {detail && <>{detail.conversion && <section className="lead-conversion-summary" aria-label="Lead conversion"><div><span className="auth-step">CONVERTED</span><h3>{detail.conversion.company.name}</h3><p>{detail.conversion.contact.name}{detail.conversion.contact.email ? ` · ${detail.conversion.contact.email}` : ''}</p>{detail.conversion.deal && <p>Deal created: {detail.conversion.deal.name}</p>}</div><span>{new Date(detail.conversion.convertedAt).toLocaleDateString()}</span></section>}{conversionOpen && conversionOptions && <form className="lead-conversion-form" onSubmit={convertLead}><div><h3>Convert lead to CRM records</h3><p>Keep the lead and its activity history. Select existing workspace records or create records from this lead.</p></div><label>Find a company or contact<div className="lead-conversion-search"><input value={conversionQuery} onChange={(event) => setConversionQuery(event.target.value)} maxLength={120} placeholder="Search this workspace" /><button className="button button-secondary" type="button" onClick={() => void loadConversionOptions(conversionQuery)} disabled={conversionBusy}>{conversionBusy ? 'Searching…' : 'Search'}</button></div></label><label>Company<select name="companyId" defaultValue=""><option value="">Create company “{detail.company}”</option>{conversionOptions.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Contact<select name="contactId" defaultValue=""><option value="">Create contact from lead{detail.email ? ` (${detail.email})` : ' (email required)'}</option>{conversionOptions.contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : ''}</option>)}</select></label>{!detail.email && <p className="lead-conversion-hint">This lead has no email. Select an existing contact or add an email before creating one.</p>}{conversionOptions.canCreateDeal && <label className="lead-conversion-checkbox"><input type="checkbox" name="createDeal" /> Also create a deal in the default pipeline</label>}<div className="lead-conversion-actions"><button className="button button-secondary" type="button" onClick={() => setConversionOpen(false)} disabled={conversionBusy}>Cancel</button><button className="button button-primary" type="submit" disabled={conversionBusy}>{conversionBusy ? 'Converting…' : 'Convert lead'}</button></div></form>}{error && <p className="lead-form-error" role="alert">{error}</p>}
<form className="lead-call-form" onSubmit={logCall}><h3>Log Call &amp; Follow-up</h3><div className="lead-call-fields"><label className="sr-only" htmlFor="lead-call-status">Call result</label><select id="lead-call-status" name="callStatus"><option value="connected">Connected</option><option value="no_answer">No answer</option><option value="busy">Busy</option><option value="callback">Callback requested</option><option value="not_interested">Not interested</option></select><input name="duration" placeholder="Duration e.g. 03:20" /><input name="callFollowUp" type="datetime-local" aria-label="Follow-up date and time" /></div><textarea name="customerResponse" placeholder="Customer response" /><textarea name="nextAction" placeholder="Next action" /><button className="button button-primary" type="submit" disabled={busy}>Save Call &amp; Update Lead</button></form><form className="lead-call-form" onSubmit={createLeadActivity}><h3>Create a follow-up</h3><div className="lead-call-fields"><select name="activityType" aria-label="Activity type"><option value="task">Task</option><option value="meeting">Meeting</option><option value="note">Note</option><option value="email">Email</option></select><select name="activityPriority" aria-label="Activity priority"><option value="normal">Normal priority</option><option value="high">High priority</option><option value="low">Low priority</option></select><input name="activityDueAt" type="datetime-local" aria-label="Due date and time" /></div><input name="activityTitle" placeholder="Task, meeting, note, or follow-up title" required maxLength={160} /><textarea name="activityDescription" placeholder="Description or internal notes" maxLength={5000} /><button className="button button-primary" type="submit" disabled={activityBusy}>{activityBusy ? 'Saving…' : 'Add to activity timeline'}</button></form><section className="lead-call-history"><h3>Activity timeline &amp; call history</h3>{detail.activities.length ? detail.activities.map((activity) => <article key={activity.id}><strong>{activity.title}</strong><span>{activity.type.toUpperCase()} · {new Date(activity.createdAt).toLocaleString()} · {activity.createdBy}{activity.assignedTo ? ` · Assigned to ${activity.assignedTo}` : ''}</span>{activity.call?.status && <span>Call result: {activity.call.status.replaceAll('_', ' ')}{activity.call.durationSeconds !== null ? ` · ${Math.floor(activity.call.durationSeconds / 60)}:${String(activity.call.durationSeconds % 60).padStart(2, '0')}` : ''}</span>}{activity.dueAt && <span>Due {new Date(activity.dueAt).toLocaleString()}</span>}{activity.description && <p>{activity.description}</p>}{activity.call?.customerResponse && <p>Customer response: {activity.call.customerResponse}</p>}{activity.call?.nextAction && <p>Next action: {activity.call.nextAction}</p>}</article>) : <p>No activity history yet.</p>}</section></>}</section></div>;
}

export default function LeadsManager() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [assignedFilters, setAssignedFilters] = useState<string[]>([]);
  const [followUpFilter, setFollowUpFilter] = useState('any');
  const [pageSize, setPageSize] = useState(25);
  const [showFilters, setShowFilters] = useState(false);
  const [followUpSummary, setFollowUpSummary] = useState({ today: 0, tomorrow: 0, overdue: 0 });
  const [leadAnalytics, setLeadAnalytics] = useState<{ bySource: DistributionDatum[]; byStatus: DistributionDatum[] }>({ bySource: [], byStatus: [] });
  const statusOptions = Array.from(new Set([...Object.keys(statusLabels), ...leadAnalytics.byStatus.map(({ label }) => label)])).sort();
  const status = statusFilters[0] ?? '';
  const setStatus = (value: string) => setStatusFilters(value ? [value] : []);
  const hasActiveFilters = Boolean(query || source || statusFilters.length || assignedFilters.length || followUpFilter !== 'any');

  useEffect(() => {
    const reloadWorkspaceData = () => { setRefresh((value) => value + 1); setAssignmentRefresh((value) => value + 1); };
    window.addEventListener('myr:organization-changed', reloadWorkspaceData);
    window.addEventListener('myr:demo-data-changed', reloadWorkspaceData);
    return () => { window.removeEventListener('myr:organization-changed', reloadWorkspaceData); window.removeEventListener('myr:demo-data-changed', reloadWorkspaceData); };
  }, []);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogLead, setDialogLead] = useState<Lead | null | undefined>(undefined);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
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
      if (statusFilters.length) params.set('statuses', statusFilters.join(','));
      if (assignedFilters.length) params.set('assignees', assignedFilters.join(','));
      if (followUpFilter !== 'any') params.set('followUp', followUpFilter);
      params.set('page', String(page)); params.set('pageSize', String(pageSize));
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
  }, [query, source, statusFilters, assignedFilters, followUpFilter, pageSize, refresh, page, sort]);

  useEffect(() => {
    let cancelled = false;
    void crmApiFetch('/leads/follow-up-summary').then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); if (!cancelled) setFollowUpSummary(payload.data); }).catch(() => { if (!cancelled) setFollowUpSummary({ today: 0, tomorrow: 0, overdue: 0 }); });
    return () => { cancelled = true; };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void crmApiFetch('/leads/analytics').then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(errorMessage(payload)); if (!cancelled) { const colors: Record<string, string> = { website: '#3979d5', facebook: '#3478d4', instagram: '#b84ca8', meta_ads: '#7757d6', google: '#db8a35', referral: '#7956d7', linkedin: '#2c9a91', other: '#e19843', new: '#477dd0', contacted: '#dd9b37', qualified: '#27976f', disqualified: '#cf5b64' }; const normalize = (items: DistributionDatum[]) => items.map((item) => ({ ...item, label: item.label.replace(/\b\w/g, (letter) => letter.toUpperCase()), color: colors[item.label] ?? '#8164ce' })); setLeadAnalytics({ bySource: normalize(payload.data.bySource ?? []), byStatus: normalize(payload.data.byStatus ?? []) }); } }).catch(() => { if (!cancelled) setLeadAnalytics({ bySource: [], byStatus: [] }); });
    return () => { cancelled = true; };
  }, [refresh]);

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
    const noticeText = dialogLead === undefined ? 'Lead list updated.' : dialogLead ? 'Lead changes saved.' : 'Lead created.';
    setDialogLead(undefined);
    setNotice(noticeText);
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
      if (statusFilters.length) params.set('statuses', statusFilters.join(','));
      if (assignedFilters.length) params.set('assignees', assignedFilters.join(','));
      if (followUpFilter !== 'any') params.set('followUp', followUpFilter);
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
    <section className="lead-charts-grid" aria-label="Lead analytics"><RadialBarChart title="Leads by source" items={leadAnalytics.bySource} /><PieBarChart title="Lead status mix" items={leadAnalytics.byStatus} unit="leads" /></section>
    {canImportLeads && showLeadCsvImport && <section id="lead-csv-import" className="panel lead-csv-import-panel" aria-label="Lead CSV import">
      <div className="lead-assignment-heading"><div><strong>Lead CSV import</strong><p>Review and validate rows before adding leads. Existing records are never overwritten.</p></div></div>
      <LeadCsvImport compact onImported={(count) => { setNotice(`${count} leads were imported.`); setRefresh((value) => value + 1); }} />
    </section>}
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Lead directory</strong><span>{loading ? 'Updating leads…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'lead' : 'leads'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search leads…" aria-label="Search leads" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Filter by source" value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">All sources</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{statusOptions.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select><select aria-label="Sort leads" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="company:asc">Company A–Z</option></select><button className="button button-secondary" type="button" onClick={() => void exportLeads()} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button></div></section>
    <div className="lead-filter-trigger"><button className="button button-secondary" type="button" aria-expanded={showFilters} onClick={() => setShowFilters((visible) => !visible)}>☷ {showFilters ? 'Hide filters' : 'Filters'}</button><button className="lead-clear-selection" type="button" onClick={() => { setSource(''); setStatusFilters([]); setAssignedFilters([]); setFollowUpFilter('any'); setPage(1); }}>Reset filters</button><span>{statusFilters.length + assignedFilters.length + (followUpFilter !== 'any' ? 1 : 0)} filters active</span></div>
    <section className="lead-follow-up-summary" aria-label="Follow-up summary">
      <button type="button" className={followUpFilter === 'today' ? 'active' : ''} onClick={() => { setFollowUpFilter(followUpFilter === 'today' ? 'any' : 'today'); setPage(1); }}><span>FOLLOW-UP</span><strong>Today’s Follow-ups</strong><small>Open today’s follow-up list</small><b>{followUpSummary.today}</b></button>
      <button type="button" className={followUpFilter === 'tomorrow' ? 'active' : ''} onClick={() => { setFollowUpFilter(followUpFilter === 'tomorrow' ? 'any' : 'tomorrow'); setPage(1); }}><span>UP NEXT</span><strong>Tomorrow</strong><small>Scheduled follow-ups</small><b>{followUpSummary.tomorrow}</b></button>
      <button type="button" className={followUpFilter === 'overdue' ? 'active' : ''} onClick={() => { setFollowUpFilter(followUpFilter === 'overdue' ? 'any' : 'overdue'); setPage(1); }}><span>NEEDS ATTENTION</span><strong>Overdue</strong><small>Follow-ups past due</small><b>{followUpSummary.overdue}</b></button>
    </section>
    {showFilters && <section className="lead-filter-panel panel" aria-label="Lead filters">
      <label>Follow-up time<select value={followUpFilter} onChange={(event) => { setFollowUpFilter(event.target.value); setPage(1); }}><option value="any">Any time</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="overdue">Overdue</option><option value="scheduled">All scheduled</option></select></label>
      <label>Engagement / source<select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }}><option value="">All engagement</option>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <fieldset><legend>Status</legend>{statusOptions.map((value) => <label key={value}><input type="checkbox" checked={statusFilters.includes(value)} onChange={() => { setStatusFilters((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); setPage(1); }} />{statusLabel(value)}</label>)}</fieldset>
      <fieldset><legend>Assigned user</legend><div className="lead-filter-scroll">{assignees.map((person) => <label key={person.id}><input type="checkbox" checked={assignedFilters.includes(person.id)} onChange={() => { setAssignedFilters((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id]); setPage(1); }} />{person.name}</label>)}</div>{!assignees.length && <small>No active assignees are available.</small>}</fieldset>
      <label>Rows per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
      <div className="lead-filter-footer"><span>{pageInfo.total.toLocaleString()} matching results · filters update as you choose</span><button className="button button-primary" type="button" onClick={() => setShowFilters(false)}>Done</button></div>
    </section>}
    {assignmentPreview && <section className="panel lead-assignment-preview" aria-label="Proposed lead assignments">
      <div className="lead-assignment-heading"><div><strong>Review proposed assignments</strong><p>{assignmentPreview.assignedCount} active leads will be distributed evenly across {assignmentPreview.assigneeCount} selected employees. No changes are applied until you confirm.</p></div><button className="lead-clear-selection" type="button" onClick={() => setAssignmentPreview(null)} disabled={assignmentBusy}>Cancel</button></div>
      <div className="lead-assignment-preview-list"><table><thead><tr><th>LEAD</th><th>CURRENT OWNER</th><th>PROPOSED OWNER</th></tr></thead><tbody>{assignmentPreview.assignments.map((assignment) => <tr key={assignment.leadId}><td>{assignment.name}</td><td>{assignment.currentOwner}</td><td>{assignment.owner}</td></tr>)}</tbody></table></div>
      <button className="button button-primary" type="button" onClick={() => void applyDistribution()} disabled={assignmentBusy || !assignmentPreview.assignments.length}>{assignmentBusy ? 'Applying…' : 'Apply proposed assignments'}</button>
    </section>}
    <section className="panel leads-table-panel"><div className="table-scroll"><table className="leads-table"><thead><tr>{canManageAssignments && <th><input type="checkbox" aria-label="Select all visible leads" checked={leads.length > 0 && leads.every((lead) => selectedLeadIds.includes(lead.id))} onChange={toggleVisibleLeads} /></th>}<th>LEAD</th><th>COMPANY</th><th>SOURCE</th><th>STATUS</th><th>OWNER</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !leads.length && Array.from({ length: 4 }, (_, index) => <tr className="lead-skeleton-row" key={`skeleton-${index}`}><td colSpan={canManageAssignments ? 7 : 6}><span /><span /><span /></td></tr>)}
      {!loading && leads.map((lead) => {
        const phone = lead.phone?.trim() ?? '';
        const phoneHref = phone ? `tel:${phone.replace(/[^+\d]/g, '')}` : undefined;
        const whatsappNumber = phone.replace(/\D/g, '');
        const assignedTeamMember = !['owner', 'read_only'].includes(lead.ownerRole ?? '');
        return <tr key={lead.id}>{canManageAssignments && <td><input type="checkbox" aria-label={`Select ${lead.name}`} checked={selectedLeadIds.includes(lead.id)} onChange={() => { setAssignmentPreview(null); setSelectedLeadIds((current) => current.includes(lead.id) ? current.filter((id) => id !== lead.id) : [...current, lead.id]); }} /></td>}<td className="lead-name-cell"><span className="module-record-mark">{lead.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><button className="lead-open-detail" type="button" onClick={() => setDetailLead(lead)}>{lead.name}</button></td><td>{lead.company}</td><td><span className={`lead-source-pill source-${lead.source}`}>{sourceLabels[lead.source]}</span></td><td><span className={statusClass(lead.status)}>{statusLabel(lead.status)}</span></td><td>{assignedTeamMember ? <><span className="avatar avatar-owner">{lead.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>{lead.owner}</> : <span className="lead-unassigned-owner">No team member assigned</span>}</td><td><div className="lead-row-actions"><a className="lead-quick-contact" href={phoneHref} aria-label={phone ? `Call ${lead.name}` : `${lead.name} has no phone number`} aria-disabled={!phone} title={phone ? 'Call lead' : 'No phone number'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 3.8h2.5l1.2 4-1.8 1.5a14 14 0 0 0 5.6 5.6l1.5-1.8 4 1.2v2.5c0 1.1-.9 2-2 2A15.2 15.2 0 0 1 5.2 5.8c0-1.1.9-2 2-2Z" /></svg></a><a className="lead-quick-contact whatsapp" href={whatsappNumber ? `https://wa.me/${whatsappNumber}` : undefined} target="_blank" rel="noopener noreferrer" aria-label={phone ? `Message ${lead.name} on WhatsApp` : `${lead.name} has no phone number`} aria-disabled={!phone} title={phone ? 'WhatsApp lead' : 'No phone number'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a8.1 8.1 0 0 1-11.9 7.1L4 20l1.3-4A8.1 8.1 0 1 1 20 11.6Z" /><path d="M9 8.3c.2-.4.4-.4.7-.4h.4c.2 0 .3.1.4.4l.6 1.3c.1.2.1.4-.1.6l-.5.6c-.2.2-.2.3-.1.5.5.8 1.1 1.4 1.9 1.8.2.1.3.1.5-.1l.7-.8c.2-.2.4-.2.6-.1l1.3.6c.2.1.3.2.3.4 0 .2-.1.8-.5 1.1-.3.4-.9.6-1.4.6-.4 0-1-.1-1.7-.4a8.4 8.4 0 0 1-3.5-3 4 4 0 0 1-.8-2.1c0-.6.3-1.1.6-1.4Z" /></svg></a><button type="button" onClick={() => setDetailLead(lead)} aria-label={`View ${lead.name}`}>Details</button><button type="button" onClick={() => void archive(lead)} aria-label={`Archive ${lead.name}`}>Archive</button></div></td></tr>;
      })}
      {!loading && !error && !leads.length && <tr><td colSpan={canManageAssignments ? 7 : 6}><div className="leads-empty"><span className="leads-empty-icon">♙</span><strong>{hasActiveFilters ? 'No matching leads' : 'No leads yet'}</strong><p>{hasActiveFilters ? 'Try changing your search or filters.' : 'Add your first lead to start building your pipeline.'}</p>{!hasActiveFilters && <button className="button button-primary" type="button" onClick={() => setDialogLead(null)}>Add a lead</button>}</div></td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>{loading ? 'Loading leads' : `Showing ${leads.length} of ${pageInfo.total} leads`}</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.max(1, pageInfo.totalPages)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogLead !== undefined && <LeadDialog lead={dialogLead} onClose={() => setDialogLead(undefined)} onSaved={saved} />}
    {detailLead && <LeadDetailDialog lead={detailLead} assignees={assignees} canAssign={canManageAssignments} onClose={() => setDetailLead(null)} onSaved={saved} onArchive={() => { setDetailLead(null); void archive(detailLead); }} />}
  </section>;
}
