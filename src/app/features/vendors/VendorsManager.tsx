'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';

type VendorStatus = 'ACTIVE' | 'PENDING' | 'ON_HOLD';
type Vendor = {
  id: string;
  name: string;
  category: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  status: VendorStatus;
  rating: number;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
};
type DialogState = { mode: 'create' } | { mode: 'edit' | 'view'; vendor: Vendor };
type DateRange = 'ALL_TIME' | '30_DAYS' | '90_DAYS' | 'THIS_YEAR';
type Summary = { total: number; active: number; pending: number; onHold: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getError(payload: unknown) {
  if (!isRecord(payload)) return 'Something went wrong. Please try again.';
  const error = isRecord(payload.error) ? payload.error : payload;
  return typeof error.message === 'string' ? error.message : 'Something went wrong. Please try again.';
}

function isVendor(value: unknown): value is Vendor {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    (value.contactPerson === null || typeof value.contactPerson === 'string') &&
    (value.email === null || typeof value.email === 'string') &&
    (value.phone === null || typeof value.phone === 'string') &&
    (value.status === 'ACTIVE' || value.status === 'PENDING' || value.status === 'ON_HOLD') &&
    typeof value.rating === 'number' &&
    typeof value.reviewCount === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string';
}

function dateThreshold(range: DateRange) {
  const now = new Date();
  if (range === 'ALL_TIME') return undefined;
  if (range === 'THIS_YEAR') return new Date(now.getFullYear(), 0, 1).toISOString();
  const days = range === '30_DAYS' ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

function vendorParams(options: {
  query: string; status: string; category: string; range: DateRange; page: number; pageSize: number;
}) {
  const params = new URLSearchParams();
  if (options.query.trim()) params.set('q', options.query.trim());
  if (options.status !== 'ALL') params.set('status', options.status);
  if (options.category !== 'ALL') params.set('category', options.category);
  const createdAfter = dateThreshold(options.range);
  if (createdAfter) params.set('createdAfter', createdAfter);
  params.set('page', String(options.page));
  params.set('pageSize', String(options.pageSize));
  return params;
}

function displayStatus(status: VendorStatus) {
  return status === 'ON_HOLD' ? 'On Hold' : status === 'PENDING' ? 'Pending' : 'Active';
}

function VendorDialog({
  dialog,
  close,
  saved,
  edit,
}: {
  dialog: DialogState;
  close: () => void;
  saved: (name: string, editing: boolean) => void;
  edit: (vendor: Vendor) => void;
}) {
  const vendor = dialog.mode === 'create' ? null : dialog.vendor;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? '').trim(),
      category: String(form.get('category') ?? '').trim(),
      contactPerson: String(form.get('contactPerson') ?? '').trim() || null,
      email: String(form.get('email') ?? '').trim() || null,
      phone: String(form.get('phone') ?? '').trim() || null,
      status: String(form.get('status') ?? 'PENDING'),
      rating: Number(form.get('rating') ?? 0),
      reviewCount: Number(form.get('reviewCount') ?? 0),
    };
    setBusy(true);
    setError('');
    try {
      const response = await crmApiFetch(vendor ? `/vendors/${vendor.id}` : '/vendors', {
        method: vendor ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getError(payload));
      saved(body.name, Boolean(vendor));
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('fetch')
        ? 'Could not reach the CRM API. Check that the API server is running.'
        : cause instanceof Error ? cause.message : 'Could not save this vendor.');
    } finally {
      setBusy(false);
    }
  }

  if (dialog.mode === 'view' && vendor) {
    return (
      <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <section className="record-dialog vendor-dialog" role="dialog" aria-modal="true" aria-labelledby="vendor-dialog-title">
          <header><div><span className="auth-step">VENDOR DETAILS</span><h2 id="vendor-dialog-title">{vendor.name}</h2><p>{vendor.category}</p></div><button type="button" aria-label="Close dialog" onClick={close}>×</button></header>
          <dl className="vendor-detail-grid">
            <div><dt>Contact person</dt><dd>{vendor.contactPerson || '—'}</dd></div>
            <div><dt>Email</dt><dd>{vendor.email || '—'}</dd></div>
            <div><dt>Phone</dt><dd>{vendor.phone || '—'}</dd></div>
            <div><dt>Status</dt><dd><span className={`vendor-status vendor-status-${vendor.status.toLowerCase()}`}>{displayStatus(vendor.status)}</span></dd></div>
            <div><dt>Rating</dt><dd>★ {vendor.rating.toFixed(1)} ({vendor.reviewCount})</dd></div>
            <div><dt>Added</dt><dd>{new Date(vendor.createdAt).toLocaleDateString()}</dd></div>
          </dl>
          <footer><button className="button button-secondary" type="button" onClick={close}>Close</button><button className="button button-primary" type="button" onClick={() => edit(vendor)}>Edit vendor</button></footer>
        </section>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className="record-dialog vendor-dialog" role="dialog" aria-modal="true" aria-labelledby="vendor-dialog-title">
        <header><div><span className="auth-step">VENDOR DETAILS</span><h2 id="vendor-dialog-title">{vendor ? 'Edit vendor' : 'Add a vendor'}</h2><p>Keep vendor and supplier information up to date.</p></div><button type="button" aria-label="Close dialog" onClick={close} disabled={busy}>×</button></header>
        <form onSubmit={submit}>
          <div className="record-dialog-fields">
            <label>Vendor name <span>required</span><input name="name" defaultValue={vendor?.name ?? ''} autoFocus required maxLength={160} placeholder="e.g. Northstar Supply" /></label>
            <label>Category <span>required</span><input name="category" defaultValue={vendor?.category ?? ''} required maxLength={120} placeholder="e.g. Office Supplies" /></label>
            <label>Contact person<input name="contactPerson" defaultValue={vendor?.contactPerson ?? ''} maxLength={120} placeholder="Contact name" /></label>
            <label>Email<input type="email" name="email" defaultValue={vendor?.email ?? ''} maxLength={254} placeholder="name@company.com" /></label>
            <label>Phone<input type="tel" name="phone" defaultValue={vendor?.phone ?? ''} maxLength={40} placeholder="+1 415 555 0134" /></label>
            <label>Status<select name="status" defaultValue={vendor?.status ?? 'PENDING'}><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="ON_HOLD">On Hold</option></select></label>
            <label>Rating <small>0–5</small><input type="number" name="rating" defaultValue={vendor?.rating ?? 0} min="0" max="5" step="0.1" /></label>
            <label>Review count<input type="number" name="reviewCount" defaultValue={vendor?.reviewCount ?? 0} min="0" max="1000000" step="1" /></label>
          </div>
          {error && <p className="lead-form-error" role="alert">{error}</p>}
          <footer><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : vendor ? 'Save changes' : 'Create vendor'}</button></footer>
        </form>
      </section>
    </div>
  );
}

export default function VendorsManager() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, active: 0, pending: 0, onHold: 0 });
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [category, setCategory] = useState('ALL');
  const [range, setRange] = useState<DateRange>('ALL_TIME');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const workspaceVersionRef = useRef(0);

  useEffect(() => {
    function onWorkspaceChange() {
      setVendors([]);
      setCategories([]);
      setSummary({ total: 0, active: 0, pending: 0, onHold: 0 });
      setPageInfo({ total: 0, totalPages: 0 });
      setPage(1);
      setDialog(null);
      setNotice('');
      setError('');
      setLoading(true);
      workspaceVersionRef.current += 1;
      setWorkspaceVersion((value) => value + 1);
    }
    window.addEventListener('myr:organization-changed', onWorkspaceChange);
    return () => window.removeEventListener('myr:organization-changed', onWorkspaceChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestWorkspaceVersion = workspaceVersionRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = vendorParams({ query, status, category, range, page, pageSize: 10 });
        const [listResponse, summaryResponse, categoriesResponse] = await Promise.all([
          crmApiFetch(`/vendors?${params.toString()}&sortBy=${encodeURIComponent(sort.split(':')[0])}&sortOrder=${encodeURIComponent(sort.split(':')[1])}`, { signal: controller.signal }),
          crmApiFetch('/vendors/summary', { signal: controller.signal }),
          crmApiFetch('/vendors/categories', { signal: controller.signal }),
        ]);
        const [listPayload, summaryPayload, categoriesPayload]: unknown[] = await Promise.all([
          listResponse.json(), summaryResponse.json(), categoriesResponse.json(),
        ]);
        for (const [response, payload] of [[listResponse, listPayload], [summaryResponse, summaryPayload], [categoriesResponse, categoriesPayload]] as const) {
          if (!response.ok) throw new Error(getError(payload));
        }
        if (!isRecord(listPayload) || !Array.isArray(listPayload.data) || !isRecord(listPayload.meta) ||
            !isRecord(summaryPayload) || !isRecord(summaryPayload.data) ||
            !isRecord(categoriesPayload) || !Array.isArray(categoriesPayload.data)) {
          throw new Error('The vendor API returned an invalid response.');
        }
        if (!listPayload.data.every(isVendor) || !categoriesPayload.data.every((item) => typeof item === 'string')) {
          throw new Error('The vendor API returned an invalid response.');
        }
        const summaryData = summaryPayload.data;
        if (![summaryData.total, summaryData.active, summaryData.pending, summaryData.onHold].every((value) => typeof value === 'number')) {
          throw new Error('The vendor summary API returned an invalid response.');
        }
        if (!cancelled && requestWorkspaceVersion === workspaceVersionRef.current) {
          setVendors(listPayload.data);
          setPageInfo({
            total: typeof listPayload.meta.total === 'number' ? listPayload.meta.total : 0,
            totalPages: typeof listPayload.meta.totalPages === 'number' ? listPayload.meta.totalPages : 0,
          });
          setSummary({
            total: summaryData.total as number,
            active: summaryData.active as number,
            pending: summaryData.pending as number,
            onHold: summaryData.onHold as number,
          });
          setCategories(categoriesPayload.data as string[]);
        }
      } catch (cause) {
        if (cancelled || requestWorkspaceVersion !== workspaceVersionRef.current || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch')
          ? 'Could not reach the CRM API. Start the API server and try again.'
          : cause instanceof Error ? cause.message : 'Could not load vendors.');
      } finally {
        if (!cancelled && requestWorkspaceVersion === workspaceVersionRef.current) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, status, category, range, page, sort, refresh, workspaceVersion]);

  async function archive(vendor: Vendor) {
    if (!window.confirm(`Archive ${vendor.name}? It will be removed from the active vendor list.`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/vendors/${vendor.id}`, { method: 'DELETE' });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getError(payload));
      setNotice(`${vendor.name} was archived.`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive this vendor.');
    }
  }

  async function exportVendors() {
    setExporting(true);
    setError('');
    const exportWorkspaceVersion = workspaceVersionRef.current;
    try {
      const allVendors: Vendor[] = [];
      let totalPages = 1;
      for (let currentPage = 1; currentPage <= totalPages; currentPage += 1) {
        if (workspaceVersionRef.current !== exportWorkspaceVersion) {
          throw new Error('Workspace changed during export. Please try again.');
        }
        const params = vendorParams({ query, status, category, range, page: currentPage, pageSize: 100 });
        const [sortBy, sortOrder] = sort.split(':');
        params.set('sortBy', sortBy);
        params.set('sortOrder', sortOrder);
        const response = await crmApiFetch(`/vendors?${params.toString()}`);
        const payload: unknown = await response.json();
        if (workspaceVersionRef.current !== exportWorkspaceVersion) {
          throw new Error('Workspace changed during export. Please try again.');
        }
        if (!response.ok) throw new Error(getError(payload));
        if (!isRecord(payload) || !Array.isArray(payload.data) || !isRecord(payload.meta) || !payload.data.every(isVendor)) {
          throw new Error('The vendor export API returned an invalid response.');
        }
        allVendors.push(...payload.data);
        totalPages = typeof payload.meta.totalPages === 'number' ? payload.meta.totalPages : 1;
      }
      const escapeCell = (value: string) => {
        const safe = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const headers = ['Vendor', 'Category', 'Contact Person', 'Email', 'Phone', 'Status', 'Rating', 'Reviews'];
      const rows = allVendors.map((vendor) => [
        vendor.name, vendor.category, vendor.contactPerson ?? '', vendor.email ?? '', vendor.phone ?? '',
        displayStatus(vendor.status), vendor.rating.toFixed(1), String(vendor.reviewCount),
      ]);
      const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'vendors.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export vendors.');
    } finally {
      setExporting(false);
    }
  }

  function saved(name: string, editing: boolean) {
    setDialog(null);
    setNotice(editing ? `${name} changes saved.` : `${name} was added.`);
    setRefresh((value) => value + 1);
  }

  const firstPage = Math.max(1, Math.min(page - 2, pageInfo.totalPages - 4));
  const pages = Array.from({ length: Math.min(5, pageInfo.totalPages) }, (_, index) => firstPage + index);

  return (
    <section className="vendors-feature">
      <div className="vendors-page-heading">
        <div className="vendors-title-wrap"><span className="vendors-heading-icon" aria-hidden="true">♧</span><div><p className="date-label">WORKSPACE / VENDORS</p><h1>Vendor Management</h1><p className="welcome-copy">Manage your vendors and suppliers efficiently.</p></div></div>
        <button className="button button-primary" type="button" onClick={() => setDialog({ mode: 'create' })}><span aria-hidden="true">＋</span> Add Vendor</button>
      </div>
      {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
      {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}

      <section className="vendor-stats" aria-label="Vendor summary">
        <article className="vendor-stat vendor-stat-blue"><span className="vendor-stat-icon" aria-hidden="true">♧</span><div><span>Total Vendors</span><strong>{summary.total}</strong><small>Across this workspace</small></div></article>
        <article className="vendor-stat vendor-stat-green"><span className="vendor-stat-icon" aria-hidden="true">✓</span><div><span>Active Vendors</span><strong>{summary.active}</strong><small>Currently active</small></div></article>
        <article className="vendor-stat vendor-stat-orange"><span className="vendor-stat-icon" aria-hidden="true">◷</span><div><span>Pending Approval</span><strong>{summary.pending}</strong><small>Awaiting approval</small></div></article>
        <article className="vendor-stat vendor-stat-purple"><span className="vendor-stat-icon" aria-hidden="true">★</span><div><span>On Hold</span><strong>{summary.onHold}</strong><small>Temporarily paused</small></div></article>
      </section>

      <section className="panel vendor-directory">
        <div className="vendor-toolbar">
          <label className="module-search vendor-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search vendors by name, email or category…" aria-label="Search vendors" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label>
          <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="ALL">All Status</option><option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="ON_HOLD">On Hold</option></select>
          <select aria-label="Filter by category" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="ALL">All Categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <select aria-label="Filter by date" value={range} onChange={(event) => { setRange(event.target.value as DateRange); setPage(1); }}><option value="ALL_TIME">All Time</option><option value="30_DAYS">Last 30 days</option><option value="90_DAYS">Last 90 days</option><option value="THIS_YEAR">This year</option></select>
          <button className="button button-secondary vendor-export" type="button" onClick={() => void exportVendors()} disabled={exporting}><span aria-hidden="true">⇩</span> {exporting ? 'Exporting…' : 'Export'}</button>
        </div>

        <div className="table-scroll">
          <table className="leads-table vendor-table">
            <thead><tr><th>VENDOR</th><th>CATEGORY</th><th>CONTACT PERSON</th><th>EMAIL</th><th>STATUS</th><th>RATING</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {vendors.map((vendor, index) => <tr key={vendor.id}>
                <td><div className="vendor-name-cell"><span className={`vendor-avatar vendor-avatar-${index % 5}`}>{vendor.name.trim().slice(0, 1).toUpperCase()}</span><strong>{vendor.name}</strong></div></td>
                <td><span className={`vendor-category vendor-category-${index % 5}`}>{vendor.category}</span></td>
                <td>{vendor.contactPerson || '—'}</td>
                <td>{vendor.email ? <a href={`mailto:${vendor.email}`}>{vendor.email}</a> : '—'}</td>
                <td><span className={`vendor-status vendor-status-${vendor.status.toLowerCase()}`}><i />{displayStatus(vendor.status)}</span></td>
                <td><span className="vendor-rating">★</span> {vendor.rating.toFixed(1)} <span className="vendor-review-count">({vendor.reviewCount})</span></td>
                <td><div className="vendor-row-actions"><button type="button" title={`Edit ${vendor.name}`} aria-label={`Edit ${vendor.name}`} onClick={() => setDialog({ mode: 'edit', vendor })}>✎</button><button type="button" title={`View ${vendor.name}`} aria-label={`View ${vendor.name}`} onClick={() => setDialog({ mode: 'view', vendor })}>◉</button><button type="button" title={`Archive ${vendor.name}`} aria-label={`Archive ${vendor.name}`} onClick={() => void archive(vendor)}>⋯</button></div></td>
              </tr>)}
              {!loading && vendors.length === 0 && <tr><td className="module-empty" colSpan={7}>{error ? 'Vendors are unavailable.' : query ? `No vendors match “${query}”.` : 'No vendors yet. Add your first vendor to get started.'}</td></tr>}
              {loading && vendors.length === 0 && <tr><td className="module-empty" colSpan={7}>Loading vendors…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="vendor-table-footer"><span>Showing {vendors.length ? (page - 1) * 10 + 1 : 0} to {(page - 1) * 10 + vendors.length} of {pageInfo.total} vendors</span><nav className="vendor-pagination" aria-label="Vendor pages">
          <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>‹</button>
          {pages.map((item) => <button key={item} type="button" aria-label={`Page ${item}`} aria-current={page === item ? 'page' : undefined} className={page === item ? 'active' : ''} disabled={loading} onClick={() => setPage(item)}>{item}</button>)}
          <button type="button" aria-label="Next page" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>›</button>
        </nav></div>
      </section>
      {dialog && <VendorDialog dialog={dialog} close={() => setDialog(null)} saved={saved} edit={(vendor) => setDialog({ mode: 'edit', vendor })} />}
    </section>
  );
}
