'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';

type Company = { id: string; name: string; industry: string | null; website: string | null; phone: string | null; email: string | null; logoUrl: string | null; companyType: string | null; description: string | null; employeeCount: number | null; annualRevenue: string | null; registrationNumber: string | null; parentCompanyId: string | null; parentCompany: { id: string; name: string } | null; country: string | null; state: string | null; city: string | null; address: string | null; postalCode: string | null; status: string; leadSource: string | null; tags: string[]; internalNotes: string | null; customFields: Record<string, unknown>; owner: string; ownerUserId: string; contactsCount: number; dealsCount: number; lastActivityAt?: string | null; nextFollowUpAt?: string | null; createdAt: string };
type Contact = { id: string; name: string; email: string; phone: string | null; title: string | null; company: string | null; companyId?: string | null; companyName?: string | null; owner: string };
type Deal = { id: string; name: string; value: string; closeDate: string | null; status: string; company: { id: string; name: string } | null; pipeline: { name: string }; stage: { name: string }; owner: string };
type Activity = { id: string; type: string; title: string; status: string; priority: string; dueAt: string | null; relatedToType: string | null; relatedToId: string | null; assignedToName: string | null; createdAt: string };
type CompanyTab = 'overview' | 'contacts' | 'deals' | 'activities' | 'tasks' | 'notes';
type CompanySummary = { total: number; customers: number; prospects: number; opportunities: number; openPipelineValue: string; byStatus: Record<string, number> };
type CompanyDraft = Partial<Omit<Company, 'id' | 'owner' | 'ownerUserId' | 'contactsCount' | 'dealsCount' | 'createdAt' | 'parentCompany'>> & Pick<Company, 'name'> & { ownerUserId?: string };

const columns: Array<{ key: keyof Company; label: string }> = [
  { key: 'name', label: 'Company' }, { key: 'industry', label: 'Industry' },
  { key: 'status', label: 'Status' }, { key: 'employeeCount', label: 'Employees' }, { key: 'annualRevenue', label: 'Annual revenue' },
  { key: 'contactsCount', label: 'Contacts' }, { key: 'dealsCount', label: 'Deals' }, { key: 'lastActivityAt', label: 'Last activity' }, { key: 'nextFollowUpAt', label: 'Next follow-up' }, { key: 'website', label: 'Website' }, { key: 'phone', label: 'Phone' }, { key: 'owner', label: 'Owner' },
];

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const data = payload as { error?: { message?: unknown }; message?: unknown };
  const value = data.error?.message ?? data.message;
  return typeof value === 'string' ? value : 'Something went wrong. Please try again.';
}

async function getData<T>(path: string, signal?: AbortSignal): Promise<{ data: T[]; meta?: { total?: number; totalPages?: number } }> {
  const response = await crmApiFetch(path, signal ? { signal } : undefined);
  const payload = await response.json();
  if (!response.ok) throw new Error(message(payload));
  return { data: Array.isArray(payload.data) ? payload.data as T[] : [], meta: payload.meta };
}

async function getAllData<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const url = new URL(path, 'http://leadpilot.local');
  url.searchParams.set('page', '1'); url.searchParams.set('pageSize', '100');
  const rows: T[] = [];
  let totalPages = 1;
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
    url.searchParams.set('page', String(pageIndex));
    const result = await getData<T>(`${url.pathname}${url.search}`, signal);
    rows.push(...result.data); totalPages = Math.max(1, result.meta?.totalPages ?? 1);
  }
  return rows;
}

function csvCell(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function normalizedDomain(value: string | null | undefined) {
  if (!value) return '';
  try { return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch { return value.trim().toLowerCase().replace(/^www\./i, ''); }
}

function companyCellValue(company: Company, key: keyof Company): ReactNode {
  if (key === 'status') return <span className={`company-status-badge status-${company.status}`}>{company.status.replaceAll('_', ' ')}</span>;
  if (key === 'employeeCount') return company.employeeCount?.toLocaleString() ?? '—';
  if (key === 'annualRevenue') return company.annualRevenue ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(company.annualRevenue)) : '—';
  if (key === 'contactsCount') return company.contactsCount;
  if (key === 'dealsCount') return company.dealsCount;
  if (key === 'lastActivityAt' || key === 'nextFollowUpAt') { const value = company[key]; return value ? new Date(value).toLocaleDateString() : '—'; }
  if (key === 'parentCompany') return company.parentCompany?.name ?? '—';
  if (key === 'tags') return company.tags.join(', ') || '—';
  if (key === 'customFields') return Object.keys(company.customFields ?? {}).length ? `${Object.keys(company.customFields).length} custom fields` : '—';
  const value = company[key];
  return typeof value === 'string' || typeof value === 'number' ? value || '—' : '—';
}

function CompanyDialog({ company, close, saved, knownCompanies, workspaceOwners }: { company: Company | null; close: () => void; saved: () => void; knownCompanies: Company[]; workspaceOwners: Array<{ id: string; name: string }> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let customFields: Record<string, unknown> = {};
    try { customFields = JSON.parse(String(form.get('customFields') ?? '{}')) as Record<string, unknown>; }
    catch { setError('Custom fields must be valid JSON.'); return; }
    const body: CompanyDraft = {
      name: String(form.get('name') ?? '').trim(), industry: String(form.get('industry') ?? '').trim() || null,
      website: String(form.get('website') ?? '').trim() || null, phone: String(form.get('phone') ?? '').trim() || null,
      email: String(form.get('email') ?? '').trim() || null, logoUrl: String(form.get('logoUrl') ?? '').trim() || null,
      companyType: String(form.get('companyType') ?? '').trim() || null, description: String(form.get('description') ?? '').trim() || null,
      employeeCount: String(form.get('employeeCount') ?? '') ? Number(form.get('employeeCount')) : null,
      annualRevenue: String(form.get('annualRevenue') ?? '').trim() || null,
      registrationNumber: String(form.get('registrationNumber') ?? '').trim() || null,
      parentCompanyId: String(form.get('parentCompanyId') ?? '') || null,
      country: String(form.get('country') ?? '').trim() || null, state: String(form.get('state') ?? '').trim() || null,
      city: String(form.get('city') ?? '').trim() || null, address: String(form.get('address') ?? '').trim() || null,
      postalCode: String(form.get('postalCode') ?? '').trim() || null, status: String(form.get('status') ?? 'prospect'),
      leadSource: String(form.get('leadSource') ?? '') || null,
      tags: String(form.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      internalNotes: String(form.get('internalNotes') ?? '').trim() || null,
      customFields,
      ...(String(form.get('ownerUserId') ?? '') ? { ownerUserId: String(form.get('ownerUserId')) } : {}),
    };
    if (body.name.length < 2) { setError('Enter a company name with at least two characters.'); return; }
    const domain = normalizedDomain(body.website);
    const duplicate = knownCompanies.find((item) => item.id !== company?.id &&
      (item.name.trim().toLowerCase() === body.name.toLowerCase() || (domain && normalizedDomain(item.website) === domain)));
    if (duplicate && !window.confirm(`${duplicate.name} may already exist${domain ? ` (${domain})` : ''}. Save this company anyway?`)) return;
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch(company ? `/companies/${company.id}` : '/companies', {
        method: company ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      saved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : cause instanceof Error ? cause.message : 'Could not save this company.');
    } finally { setBusy(false); }
  }
  const owners = workspaceOwners.length ? workspaceOwners : [...new Map(knownCompanies.map((row) => [row.ownerUserId, { id: row.ownerUserId, name: row.owner }])).values()];
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="record-dialog company-dialog" role="dialog" aria-modal="true" aria-labelledby="company-dialog-title"><header><div><span className="auth-step">COMPANY PROFILE</span><h2 id="company-dialog-title">{company ? 'Edit company' : 'Add a company'}</h2><p>Maintain the business profile, location and workspace relationships.</p></div><button type="button" aria-label="Close dialog" onClick={close} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields">
    <label>Company name <span>required</span><input name="name" defaultValue={company?.name ?? ''} autoFocus required minLength={2} maxLength={160} placeholder="e.g. Northstar Labs" /></label>
    <label>Industry<input name="industry" defaultValue={company?.industry ?? ''} maxLength={120} placeholder="e.g. Technology" /></label>
    <label>Company type<input name="companyType" defaultValue={company?.companyType ?? ''} maxLength={80} placeholder="Customer, reseller, partner…" /></label>
    <label>Status<select name="status" defaultValue={company?.status ?? 'prospect'}>{['prospect','engaged','opportunity','customer','inactive','lost'].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select></label>
    <label>Website<input type="url" name="website" defaultValue={company?.website ?? ''} maxLength={255} placeholder="https://company.com" /></label>
    <label>Company email<input type="email" name="email" defaultValue={company?.email ?? ''} maxLength={254} placeholder="hello@company.com" /></label>
    <label>Phone<input name="phone" defaultValue={company?.phone ?? ''} maxLength={40} placeholder="+1 415 555 0134" /></label>
    <label>Logo URL<input type="url" name="logoUrl" defaultValue={company?.logoUrl ?? ''} maxLength={2048} placeholder="https://…" /></label>
    <label>Employee count<input name="employeeCount" type="number" min="0" defaultValue={company?.employeeCount ?? ''} /></label>
    <label>Annual revenue<input name="annualRevenue" type="number" min="0" step="0.01" defaultValue={company?.annualRevenue ?? ''} /></label>
    <label>Registration number<input name="registrationNumber" defaultValue={company?.registrationNumber ?? ''} maxLength={120} /></label>
    <label>Lead source<select name="leadSource" defaultValue={company?.leadSource ?? ''}><option value="">Not set</option>{['website','facebook','instagram','meta_ads','google','referral','linkedin','other'].map((value) => <option key={value} value={value}>{value.replace('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select></label>
    <label>Parent company<select name="parentCompanyId" defaultValue={company?.parentCompanyId ?? ''}><option value="">No parent</option>{knownCompanies.filter((row) => row.id !== company?.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <label>Assigned owner<select name="ownerUserId" defaultValue={company?.ownerUserId ?? ''}><option value="">Keep current owner</option>{owners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Tags <span>comma separated</span><input name="tags" defaultValue={company?.tags.join(', ') ?? ''} maxLength={2400} placeholder="enterprise, priority" /></label>
    <label>Country<input name="country" defaultValue={company?.country ?? ''} maxLength={120} /></label>
    <label>State / region<input name="state" defaultValue={company?.state ?? ''} maxLength={120} /></label>
    <label>City<input name="city" defaultValue={company?.city ?? ''} maxLength={120} /></label>
    <label>Postal code<input name="postalCode" defaultValue={company?.postalCode ?? ''} maxLength={40} /></label>
    <label className="company-form-wide">Street address<input name="address" defaultValue={company?.address ?? ''} maxLength={500} /></label>
    <label className="company-form-wide">Description<textarea name="description" defaultValue={company?.description ?? ''} maxLength={10000} /></label>
    <label className="company-form-wide">Internal notes<textarea name="internalNotes" defaultValue={company?.internalNotes ?? ''} maxLength={10000} /></label>
    <label className="company-form-wide">Custom fields (JSON)<textarea name="customFields" defaultValue={JSON.stringify(company?.customFields ?? {}, null, 2)} maxLength={16000} /></label>
  </div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : company ? 'Save changes' : 'Create company'}</button></footer></form></section></div>;
}
function CompanyProfile({ company, close }: { company: Company; close: () => void }) {
  const [tab, setTab] = useState<CompanyTab>('overview');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [linkableContacts, setLinkableContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingContactId, setSavingContactId] = useState('');
  const [contactNotice, setContactNotice] = useState('');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const [companyResponse, activityRows] = await Promise.all([
          crmApiFetch(`/companies/${encodeURIComponent(company.id)}`, { signal: controller.signal }),
          getAllData<Activity>(`/activities?relatedToType=company&relatedToId=${encodeURIComponent(company.id)}&sortBy=createdAt&sortOrder=desc`, controller.signal),
        ]);
        const companyPayload = await companyResponse.json();
        if (!companyResponse.ok) throw new Error(message(companyPayload));
        const profile = companyPayload.data as { contacts?: Contact[]; deals?: Deal[] } | undefined;
        setContacts(Array.isArray(profile?.contacts) ? profile.contacts : []);
        setDeals(Array.isArray(profile?.deals) ? profile.deals : []);
        setActivities(activityRows);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load company relationships.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [company.id, company.name, refresh]);

  useEffect(() => {
    if (tab !== 'contacts' || contactSearch.trim().length < 2) { setLinkableContacts([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getAllData<Contact>(`/contacts?q=${encodeURIComponent(contactSearch.trim())}&sortBy=name&sortOrder=asc`, controller.signal)
        .then((rows) => setLinkableContacts(rows.filter((contact) => contact.companyId !== company.id)))
        .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not search contacts.'); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [tab, contactSearch, company.id]);

  async function setContactCompany(contact: Contact, companyId: string | null) {
    setSavingContactId(contact.id); setError(''); setContactNotice('');
    try {
      const response = await crmApiFetch(`/contacts/${encodeURIComponent(contact.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setContactSearch(''); setLinkableContacts([]); setContactNotice(companyId ? `${contact.name} linked to ${company.name}.` : `${contact.name} unlinked.`); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the contact relationship.'); }
    finally { setSavingContactId(''); }
  }
  const tabs: Array<[CompanyTab, string]> = [['overview', 'Overview'], ['contacts', `Contacts (${contacts.length})`], ['deals', `Deals (${deals.length})`], ['activities', 'Activities'], ['tasks', 'Tasks'], ['notes', 'Notes']];
  const totalDeals = deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0);
  const companyActivities = activities.filter((activity) => activity.type !== 'task' && activity.type !== 'note');
  const tasks = activities.filter((activity) => activity.type === 'task');
  const notes = activities.filter((activity) => activity.type === 'note');
  function activityList(items: Activity[]) {
    if (loading) return <p className="company-profile-empty">Loading company history…</p>;
    if (!items.length) return <p className="company-profile-empty">No related records yet.</p>;
    return <div className="company-profile-list">{items.map((item) => <article key={item.id}><span className="company-profile-kind">{item.type} · {item.priority}</span><strong>{item.title}</strong><small>{item.status.replace('_', ' ')}{item.dueAt ? ` · ${new Date(item.dueAt).toLocaleDateString()}` : ''}{item.assignedToName ? ` · ${item.assignedToName}` : ''}</small></article>)}</div>;
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="record-dialog company-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="company-profile-title"><header><div><span className="auth-step">COMPANY PROFILE</span><h2 id="company-profile-title">{company.name}</h2><p>{company.industry || 'Industry not set'} · Owned by {company.owner}</p></div><button type="button" aria-label="Close company profile" onClick={close}>×</button></header><nav className="company-profile-tabs" aria-label="Company details">{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav><div className="company-profile-body">{error && <p className="lead-form-error" role="alert">{error}</p>}{contactNotice && <p className="module-notice" role="status">{contactNotice}</p>}{tab === 'overview' && <div className="company-profile-overview"><article><span>Industry</span><strong>{company.industry || '—'}</strong></article><article><span>Website</span><strong>{company.website ? <a href={company.website} target="_blank" rel="noreferrer">{company.website.replace(/^https?:\/\//, '')}</a> : '—'}</strong></article><article><span>Phone</span><strong>{company.phone || '—'}</strong></article><article><span>Associated contacts</span><strong>{loading ? '…' : contacts.length}</strong></article><article><span>Active deals</span><strong>{loading ? '…' : deals.filter((deal) => deal.status === 'open').length}</strong></article><article><span>Open deal value</span><strong>{loading ? '…' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(deals.filter((deal) => deal.status === 'open').reduce((sum, deal) => sum + Number(deal.value || 0), 0))}</strong></article><article><span>Total pipeline value</span><strong>{loading ? '…' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalDeals)}</strong></article><article><span>Added</span><strong>{new Date(company.createdAt).toLocaleDateString()}</strong></article></div>}{tab === 'contacts' && <><label className="company-contact-search">Find an existing contact<input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search by name, email, or company" /></label>{linkableContacts.length > 0 && <div className="company-profile-list">{linkableContacts.map((contact) => <article key={contact.id}><span className="company-profile-kind">{contact.title || 'Contact'} · {contact.owner}</span><strong>{contact.name}</strong><small>{contact.email}{contact.phone ? ` · ${contact.phone}` : ''}</small><button className="button button-secondary" type="button" disabled={Boolean(savingContactId)} onClick={() => void setContactCompany(contact, company.id)}>{savingContactId === contact.id ? 'Linking…' : 'Link contact'}</button></article>)}</div>}{loading ? <p className="company-profile-empty">Loading contacts…</p> : contacts.length ? <div className="company-profile-list">{contacts.map((contact) => <article key={contact.id}><span className="company-profile-kind">{contact.title || 'Contact'} · {contact.owner}</span><strong>{contact.name}</strong><small><a href={`mailto:${contact.email}`}>{contact.email}</a>{contact.phone ? ` · ${contact.phone}` : ''}</small><button className="button button-secondary" type="button" disabled={Boolean(savingContactId)} onClick={() => void setContactCompany(contact, null)}>{savingContactId === contact.id ? 'Saving…' : 'Remove association'}</button></article>)}</div> : <p className="company-profile-empty">No contacts are linked to this company yet. Search to link an existing contact.</p>}</>}{tab === 'deals' && (loading ? <p className="company-profile-empty">Loading deals…</p> : deals.length ? <div className="company-profile-list">{deals.map((deal) => <article key={deal.id}><span className="company-profile-kind">{deal.pipeline.name} · {deal.stage.name} · {deal.status}</span><strong>{deal.name}</strong><small>{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(deal.value || 0))} · {deal.owner}{deal.closeDate ? ` · Closes ${new Date(deal.closeDate).toLocaleDateString()}` : ''}</small></article>)}</div> : <p className="company-profile-empty">No deals are linked to this company.</p>)}{tab === 'activities' && activityList(companyActivities)}{tab === 'tasks' && activityList(tasks)}{tab === 'notes' && activityList(notes)}{(tab === 'activities' || tab === 'tasks' || tab === 'notes') && <Link className="button button-secondary company-profile-activity-link" href="/activities">Open activities &amp; tasks</Link>}</div></section></div>;
}

export default function CompaniesManager() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [industry, setIndustry] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('');
  const [leadSource, setLeadSource] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [summary, setSummary] = useState<CompanySummary>({ total: 0, customers: 0, prospects: 0, opportunities: 0, openPipelineValue: '0', byStatus: {} });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogCompany, setDialogCompany] = useState<Company | null | undefined>(undefined);
  const [profileCompany, setProfileCompany] = useState<Company | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(columns.map(({ key }) => key));
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string }>>([]);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkOwner, setBulkOwner] = useState('');
  const [canAssignOwners, setCanAssignOwners] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getData<{ id: string; name: string }>('/organizations/assignees', controller.signal)
      .then((result) => { setAssignees(result.data); setCanAssignOwners(true); })
      .catch(() => { if (!controller.signal.aborted) { setAssignees([]); setCanAssignOwners(false); } });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (industry) params.set('industry', industry);
        if (status) params.set('status', status);
        if (leadSource) params.set('leadSource', leadSource);
        if (companyType) params.set('companyType', companyType);
        if (owner) params.set('ownerUserId', owner);
        if (showArchived) params.set('archived', 'true');
        params.set('page', String(page)); params.set('pageSize', '25');
        const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
        const result = await getData<Company>(`/companies?${params}`, controller.signal);
        if (!cancelled) { setCompanies(result.data); setPageInfo({ total: result.meta?.total ?? 0, totalPages: result.meta?.totalPages ?? 0 }); setSelected([]); }
      } catch (cause) {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'Could not load companies.');
      } finally { if (!cancelled) setLoading(false); }
    }, query ? 200 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, refresh, page, sort, industry, status, leadSource, companyType, owner, showArchived]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await crmApiFetch('/companies/summary', { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload));
        const data = payload.data && typeof payload.data === 'object' ? payload.data as Partial<CompanySummary> : {};
        setSummary({ total: Number(data.total) || 0, customers: Number(data.customers) || 0, prospects: Number(data.prospects) || 0, opportunities: Number(data.opportunities) || 0, openPipelineValue: typeof data.openPipelineValue === 'string' ? data.openPipelineValue : '0', byStatus: data.byStatus ?? {} });
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load company statistics.');
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  const industries = useMemo(() => [...new Set(companies.map((company) => company.industry).filter((value): value is string => Boolean(value)))].sort(), [companies]);
  const owners = useMemo(() => (assignees.length ? assignees : [...new Map(companies.map((company) => [company.ownerUserId, { id: company.ownerUserId, name: company.owner }])).values()]).sort((a, b) => a.name.localeCompare(b.name)), [assignees, companies]);
  const filteredCompanies = companies;
  const selectedOnPage = filteredCompanies.length > 0 && filteredCompanies.every((company) => selected.includes(company.id));

  async function exportCompanies() {
    setExporting(true); setError('');
    try {
      const rows: Company[] = [];
      let totalPages = 1;
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (industry) params.set('industry', industry);
      if (status) params.set('status', status);
      if (leadSource) params.set('leadSource', leadSource);
      if (companyType) params.set('companyType', companyType);
      if (owner) params.set('ownerUserId', owner);
      if (showArchived) params.set('archived', 'true');
      params.set('pageSize', '100');
      const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
      for (let pageIndex = 1; pageIndex <= totalPages; pageIndex += 1) {
        params.set('page', String(pageIndex));
        const result = await getData<Company>(`/companies?${params}`);
        rows.push(...result.data); totalPages = Math.max(1, result.meta?.totalPages ?? 1);
      }
      const output = [columns.map((column) => column.label), ...rows.map((row) => columns.map(({ key }) => row[key] ?? ''))]
        .map((row) => row.map(csvCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${output}`], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `leadpilot-companies-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice(`Exported ${rows.length} ${rows.length === 1 ? 'company' : 'companies'} matching the search.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export companies.'); }
    finally { setExporting(false); }
  }

  async function importCsv(file: File) {
    setBusy(true); setError(''); setNotice('');
    try {
      const text = await file.text();
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) throw new Error('The CSV needs a header row and at least one company row.');
      const parseRow = (line: string) => line.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)?.map((cell) => cell.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"')) ?? [];
      const header = parseRow(lines[0]).map((value) => value.trim().toLowerCase());
      const index = (name: string) => header.indexOf(name);
      if (index('name') < 0) throw new Error('Include a required “name” column. Supported columns: name, industry, website, phone.');
      if (lines.length > 501) throw new Error('Import up to 500 companies per CSV.');
      let created = 0; let duplicates = 0; let failed = 0;
      for (const line of lines.slice(1)) {
        const row = parseRow(line);
        const draft = { name: row[index('name')]?.trim(), industry: row[index('industry')]?.trim() || null, website: row[index('website')]?.trim() || null, phone: row[index('phone')]?.trim() || null };
        if (!draft.name) { failed += 1; continue; }
        const search = new URLSearchParams({ q: draft.name, page: '1', pageSize: '100' });
        const existing = await getData<Company>(`/companies?${search}`);
        const domain = normalizedDomain(draft.website);
        if (existing.data.some((item) => item.name.toLowerCase() === draft.name!.toLowerCase() || (domain && normalizedDomain(item.website) === domain))) { duplicates += 1; continue; }
        const response = await crmApiFetch('/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        const payload = await response.json();
        if (response.ok) created += 1; else failed += 1;
      }
      setNotice(`Imported ${created}; skipped ${duplicates} possible duplicates; ${failed} rows could not be imported.`);
      setPage(1); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import companies.'); }
    finally { setBusy(false); }
  }

  async function archive(company?: Company) {
    const targetIds = selected.length ? selected : company ? [company.id] : [];
    if (!targetIds.length) return;
    const label = selected.length ? `${selected.length} selected companies` : company?.name ?? 'this company';
    if (!window.confirm(`Archive ${label}? Archived records leave the active company list.`)) return;
    setBusy(true); setError('');
    try {
      const results = await Promise.all(targetIds.map(async (id) => {
        const response = await crmApiFetch(`/companies/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(message(await response.json()));
        return id;
      }));
      setSelected([]); setNotice(`Archived ${results.length} ${results.length === 1 ? 'company' : 'companies'}.`); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive companies.'); }
    finally { setBusy(false); }
  }

  async function updateSelected(patch: { status?: string; ownerUserId?: string }) {
    if (!selected.length) return;
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch('/companies/bulk/update', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: selected, ...patch }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setSelected([]); setBulkStatus(''); setBulkOwner(''); setNotice(`Updated ${Number(payload.data?.updatedCount) || 0} companies.`); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update selected companies.'); }
    finally { setBusy(false); }
  }

  async function restore(company?: Company) {
    const targetIds = selected.length ? selected : company ? [company.id] : [];
    if (!targetIds.length) return;
    setBusy(true); setError('');
    try {
      await Promise.all(targetIds.map(async (id) => {
        const response = await crmApiFetch(`/companies/${id}/restore`, { method: 'POST' });
        if (!response.ok) throw new Error(message(await response.json()));
      }));
      setSelected([]); setNotice(`Restored ${targetIds.length} ${targetIds.length === 1 ? 'company' : 'companies'}.`); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore companies.'); }
    finally { setBusy(false); }
  }

  function saved() { const editing = Boolean(dialogCompany); setDialogCompany(undefined); setNotice(editing ? 'Company changes saved.' : 'Company created.'); setRefresh((value) => value + 1); }
  function togglePageSelection(checked: boolean) {
    const pageIds = new Set(filteredCompanies.map(({ id }) => id));
    setSelected((current) => checked
      ? [...new Set([...current, ...pageIds])]
      : current.filter((id) => !pageIds.has(id)));
  }

  return <section className="companies-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / COMPANIES</p><h1>Companies</h1><p className="welcome-copy">A clear view of the organizations and opportunities linked to your team.</p></div><div className="leads-header-actions"><button className="button button-secondary" type="button" onClick={() => void exportCompanies()} disabled={exporting || !pageInfo.total}>{exporting ? 'Exporting…' : 'Export CSV'}</button><label className="button button-secondary company-import-button">{busy ? 'Importing…' : 'Import CSV'}<input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importCsv(file); event.currentTarget.value = ''; }} /></label><button className="button button-primary" type="button" onClick={() => setDialogCompany(null)} disabled={busy}>＋ Add company</button></div></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className="company-kpis" aria-label="Company directory summary"><article><span>Total companies</span><strong>{loading ? '…' : (summary?.total ?? 0).toLocaleString()}</strong><small>Active records in this workspace</small></article><article><span>Active customers</span><strong>{loading ? '…' : (summary?.customers ?? 0).toLocaleString()}</strong><small>Companies marked as customers</small></article><article><span>Prospects</span><strong>{loading ? '…' : (summary?.prospects ?? 0).toLocaleString()}</strong><small>Early relationship stage</small></article><article><span>Open opportunities</span><strong>{loading ? '…' : (summary?.opportunities ?? 0).toLocaleString()}</strong><small>Companies at opportunity stage</small></article><article><span>Total pipeline value</span><strong>{loading ? '…' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(summary?.openPipelineValue ?? 0))}</strong><small>Value across open deals</small></article></section>
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Company directory</strong><span>{loading ? 'Updating companies…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'company' : 'companies'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search name, industry, website…" aria-label="Search companies" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Filter this page by industry" value={industry} onChange={(event) => { setIndustry(event.target.value); setPage(1); }}><option value="">All industries</option>{industries.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Filter companies by owner" value={owner} onChange={(event) => { setOwner(event.target.value); setPage(1); }}><option value="">All owners</option>{owners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="Filter companies by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{["prospect","engaged","opportunity","customer","inactive","lost"].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select><select aria-label="Filter companies by lead source" value={leadSource} onChange={(event) => { setLeadSource(event.target.value); setPage(1); }}><option value="">All lead sources</option>{['website','facebook','instagram','meta_ads','google','referral','linkedin','other'].map((value) => <option key={value} value={value}>{value.replace('_',' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}</option>)}</select><select aria-label="Filter companies by type" value={companyType} onChange={(event) => { setCompanyType(event.target.value); setPage(1); }}><option value="">All company types</option>{[...new Set(companies.map(({ companyType: value }) => value).filter((value): value is string => Boolean(value)))].sort().map((value) => <option key={value}>{value}</option>)}</select><button className="button button-secondary" type="button" aria-pressed={showArchived} onClick={() => { setShowArchived((value) => !value); setPage(1); }}>{showArchived ? "Active companies" : "Archived companies"}</button><select aria-label="Sort companies" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="industry:asc">Industry A–Z</option><option value="industry:desc">Industry Z–A</option></select><div className="company-column-control"><button className="button button-secondary" type="button" aria-expanded={showColumnMenu} onClick={() => setShowColumnMenu((open) => !open)}>Columns</button>{showColumnMenu && <div className="company-column-menu" role="group" aria-label="Visible company columns">{columns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visibleColumns.includes(key)} onChange={() => setVisibleColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />{label}</label>)}</div>}</div></div></section>
    {selected.length > 0 && <div className="company-bulk-bar"><span>{selected.length} selected</span>{!showArchived && <><select aria-label="Bulk company status" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}><option value="">Set status…</option>{['prospect','engaged','opportunity','customer','inactive','lost'].map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}</select><button className="button button-secondary" type="button" disabled={busy || !bulkStatus} onClick={() => void updateSelected({ status: bulkStatus })}>Update status</button>{canAssignOwners && <><select aria-label="Bulk company owner" value={bulkOwner} onChange={(event) => setBulkOwner(event.target.value)}><option value="">Assign owner…</option>{owners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><button className="button button-secondary" type="button" disabled={busy || !bulkOwner} onClick={() => void updateSelected({ ownerUserId: bulkOwner })}>Assign owner</button></>}</>}<button className="button button-secondary" type="button" onClick={() => setSelected([])}>Clear selection</button>{showArchived ? <button className="button button-primary" type="button" disabled={busy} onClick={() => void restore(filteredCompanies[0])}>Restore selected</button> : <button className="button button-danger" type="button" disabled={busy} onClick={() => void archive(filteredCompanies[0])}>Archive selected</button>}</div>}
    <section className="panel leads-table-panel company-table-panel"><div className="table-scroll"><table className="leads-table company-table"><thead><tr><th><input type="checkbox" aria-label="Select all companies on this page" checked={selectedOnPage} onChange={(event) => togglePageSelection(event.target.checked)} /></th>{columns.filter(({ key }) => visibleColumns.includes(key)).map(({ key, label }) => <th key={key}>{label.toUpperCase()}</th>)}<th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !companies.length && Array.from({ length: 4 }, (_, index) => <tr className="lead-skeleton-row" key={`skeleton-${index}`}><td colSpan={visibleColumns.length + 4}><span /><span /><span /></td></tr>)}
      {!loading && filteredCompanies.map((company) => <tr key={company.id}><td><input type="checkbox" aria-label={`Select ${company.name}`} checked={selected.includes(company.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, company.id] : current.filter((id) => id !== company.id))} /></td>{columns.filter(({ key }) => visibleColumns.includes(key)).map(({ key }) => <td key={key}>{key === 'name' ? <button className="company-name-link" type="button" onClick={() => setProfileCompany(company)}><span className="company-record-mark">{company.name.trim().slice(0, 1).toUpperCase()}</span><span><strong>{company.name}</strong><small>{company.industry || 'Company profile'}</small></span></button> : key === 'website' ? company.website ? <a className="company-website" href={company.website} target="_blank" rel="noreferrer">{company.website.replace(/^https?:\/\//, '')}</a> : '—' : companyCellValue(company, key)}</td>)}<td><div className="lead-row-actions"><button type="button" onClick={() => setProfileCompany(company)}>View</button><button type="button" onClick={() => setDialogCompany(company)}>Edit</button>{showArchived ? <button type="button" onClick={() => void restore(company)} disabled={busy}>Restore</button> : <button type="button" onClick={() => void archive(company)} disabled={busy}>Archive</button>}</div></td></tr>)}
      {!loading && !filteredCompanies.length && <tr><td className="module-empty" colSpan={visibleColumns.length + 2}>{error ? 'Companies are unavailable.' : query || industry || owner ? 'No companies match these filters.' : 'No companies yet. Add your first company to get started.'}</td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>{loading ? 'Loading companies…' : `Showing ${filteredCompanies.length} of ${pageInfo.total} companies`}</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(pageInfo.totalPages, 1)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogCompany !== undefined && <CompanyDialog company={dialogCompany} close={() => setDialogCompany(undefined)} saved={saved} knownCompanies={companies} workspaceOwners={assignees} />}
    {profileCompany && <CompanyProfile company={profileCompany} close={() => setProfileCompany(null)} />}
  </section>;
}
