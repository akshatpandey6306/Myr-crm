'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';

type Company = { id: string; name: string; industry: string | null; website: string | null; phone: string | null; owner: string; createdAt: string };
type CompanyDraft = Pick<Company, 'name' | 'industry' | 'website' | 'phone'>;

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const data = payload as { error?: { message?: unknown }; message?: unknown };
  const value = data.error?.message ?? data.message;
  return typeof value === 'string' ? value : 'Something went wrong. Please try again.';
}

function CompanyDialog({ company, close, saved }: { company: Company | null; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: CompanyDraft = {
      name: String(form.get('name') ?? '').trim(),
      industry: String(form.get('industry') ?? '').trim() || null,
      website: String(form.get('website') ?? '').trim() || null,
      phone: String(form.get('phone') ?? '').trim() || null,
    };
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch(company ? `/companies/${company.id}` : '/companies', {
        method: company ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      saved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : cause instanceof Error ? cause.message : 'Could not save this company.');
    } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="record-dialog company-dialog" role="dialog" aria-modal="true" aria-labelledby="company-dialog-title"><header><div><span className="auth-step">COMPANY DETAILS</span><h2 id="company-dialog-title">{company ? 'Edit company' : 'Add a company'}</h2><p>Keep company information current for your team.</p></div><button type="button" aria-label="Close dialog" onClick={close} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields"><label>Company name <span>required</span><input name="name" defaultValue={company?.name ?? ''} autoFocus required maxLength={160} placeholder="e.g. Northstar Labs" /></label><label>Industry<input name="industry" defaultValue={company?.industry ?? ''} maxLength={120} placeholder="e.g. Technology" /></label><label>Website<input type="url" name="website" defaultValue={company?.website ?? ''} maxLength={255} placeholder="https://company.com" /></label><label>Phone<input name="phone" defaultValue={company?.phone ?? ''} maxLength={40} placeholder="+1 415 555 0134" /></label></div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : company ? 'Save changes' : 'Create company'}</button></footer></form></section></div>;
}

export default function CompaniesManager() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogCompany, setDialogCompany] = useState<Company | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        params.set('page', String(page)); params.set('pageSize', '25');
        const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
        const response = await crmApiFetch(`/companies?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload));
        if (!cancelled) {
          setCompanies(Array.isArray(payload.data) ? payload.data as Company[] : []);
          setPageInfo({ total: payload.meta?.total ?? 0, totalPages: payload.meta?.totalPages ?? 0 });
        }
      } catch (cause) {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Start the API server and try again.' : cause instanceof Error ? cause.message : 'Could not load companies.');
      } finally { if (!cancelled) setLoading(false); }
    }, query ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, refresh, page, sort]);

  async function archive(company: Company) {
    if (!window.confirm(`Archive ${company.name}? It will be removed from the active company list.`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/companies/${company.id}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setNotice(`${company.name} was archived.`);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive this company.'); }
  }

  function saved() {
    const editing = Boolean(dialogCompany);
    setDialogCompany(undefined);
    setNotice(editing ? 'Company changes saved.' : 'Company created.');
    setRefresh((value) => value + 1);
  }

  return <section className="companies-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / COMPANIES</p><h1>Companies</h1><p className="welcome-copy">See the organizations your team is building relationships with.</p></div><button className="button button-primary" type="button" onClick={() => setDialogCompany(null)}><span aria-hidden="true">＋</span> Add company</button></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Company directory</strong><span>{loading ? 'Updating companies…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'company' : 'companies'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search companies…" aria-label="Search companies" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Sort companies" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="name:asc">Name A–Z</option><option value="industry:asc">Industry A–Z</option></select></div></section>
    <section className="panel leads-table-panel company-table-panel"><div className="table-scroll"><table className="leads-table company-table"><thead><tr><th>COMPANY</th><th>INDUSTRY</th><th>WEBSITE</th><th>PHONE</th><th>OWNER</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {companies.map((company) => <tr key={company.id}><td className="lead-name-cell">{company.name}</td><td>{company.industry || '—'}</td><td>{company.website ? <a className="company-website" href={company.website} target="_blank" rel="noreferrer">{company.website.replace(/^https?:\/\//, '')}</a> : '—'}</td><td>{company.phone || '—'}</td><td>{company.owner}</td><td><div className="lead-row-actions"><button type="button" onClick={() => setDialogCompany(company)}>Edit</button><button type="button" onClick={() => void archive(company)}>Archive</button></div></td></tr>)}
      {!loading && companies.length === 0 && <tr><td className="module-empty" colSpan={6}>{error ? 'Companies are unavailable.' : query ? `No companies match “${query}”.` : 'No companies yet. Add your first company to get started.'}</td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>Showing {companies.length} of {pageInfo.total} companies</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(pageInfo.totalPages, 1)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogCompany !== undefined && <CompanyDialog company={dialogCompany} close={() => setDialogCompany(undefined)} saved={saved} />}
  </section>;
}
