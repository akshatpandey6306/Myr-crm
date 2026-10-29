'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { crmApiFetch } from '../../../lib/api-client';

type Contact = { id: string; name: string; email: string; phone: string | null; title: string | null; company: string | null; owner: string };
type Draft = Pick<Contact, 'name' | 'email' | 'phone' | 'title' | 'company'>;

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const data = payload as { error?: { message?: unknown }; message?: unknown };
  const value = data.error?.message ?? data.message;
  return typeof value === 'string' ? value : 'Something went wrong. Please try again.';
}

function ContactDialog({ contact, close, saved }: { contact: Contact | null; close: () => void; saved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Draft = {
      name: String(form.get('name') ?? '').trim(), email: String(form.get('email') ?? '').trim(),
      phone: String(form.get('phone') ?? '').trim() || null, title: String(form.get('title') ?? '').trim() || null,
      company: String(form.get('company') ?? '').trim() || null,
    };
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch(contact ? `/contacts/${contact.id}` : '/contacts', {
        method: contact ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      saved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : cause instanceof Error ? cause.message : 'Could not save this contact.');
    } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="record-dialog contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title"><header><div><span className="auth-step">CONTACT DETAILS</span><h2 id="contact-dialog-title">{contact ? 'Edit contact' : 'Add a contact'}</h2><p>Keep the important relationship details close at hand.</p></div><button type="button" aria-label="Close dialog" onClick={close} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields"><label>Name <span>required</span><input name="name" defaultValue={contact?.name ?? ''} autoFocus required maxLength={120} placeholder="e.g. Olivia Rhye" /></label><label>Email <span>required</span><input type="email" name="email" defaultValue={contact?.email ?? ''} required maxLength={254} placeholder="olivia@company.com" /></label><label>Company<input name="company" defaultValue={contact?.company ?? ''} maxLength={160} placeholder="Company name" /></label><label>Job title<input name="title" defaultValue={contact?.title ?? ''} maxLength={120} placeholder="e.g. VP of Operations" /></label><label>Phone<input name="phone" defaultValue={contact?.phone ?? ''} maxLength={40} placeholder="+1 415 555 0134" /></label></div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : contact ? 'Save changes' : 'Create contact'}</button></footer></form></section></div>;
}

export default function ContactsManager() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 0 });
  const [sort, setSort] = useState('createdAt:desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogContact, setDialogContact] = useState<Contact | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams(); if (query.trim()) params.set('q', query.trim());
        params.set('page', String(page)); params.set('pageSize', '25');
        const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
        const response = await crmApiFetch(`/contacts${params.size ? `?${params.toString()}` : ''}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload));
        if (!cancelled) { setContacts(Array.isArray(payload.data) ? payload.data as Contact[] : []); setPageInfo({ total: payload.meta?.total ?? 0, totalPages: payload.meta?.totalPages ?? 0 }); }
      } catch (cause) {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Start the API server and try again.' : cause instanceof Error ? cause.message : 'Could not load contacts.');
      } finally { if (!cancelled) setLoading(false); }
    }, query ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [query, refresh, page, sort]);

  async function archive(contact: Contact) {
    if (!window.confirm(`Archive ${contact.name}? It will be removed from the active contact list.`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/contacts/${contact.id}`, { method: 'DELETE' });
      const payload = await response.json(); if (!response.ok) throw new Error(message(payload));
      setNotice(`${contact.name} was archived.`); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive this contact.'); }
  }

  function saved() {
    const editing = Boolean(dialogContact); setDialogContact(undefined);
    setNotice(editing ? 'Contact changes saved.' : 'Contact created.'); setRefresh((value) => value + 1);
  }

  return <section className="contacts-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / CONTACTS</p><h1>Contacts</h1><p className="welcome-copy">Keep customer relationships organized and easy to follow.</p></div><button className="button button-primary" type="button" onClick={() => setDialogContact(null)}><span aria-hidden="true">＋</span> Add contact</button></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className="leads-toolbar panel"><div className="leads-toolbar-copy"><strong>Contact directory</strong><span>{loading ? 'Updating contacts…' : `${pageInfo.total} ${pageInfo.total === 1 ? 'contact' : 'contacts'} total`}</span></div><div className="leads-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search contacts…" aria-label="Search contacts" />{query && <button type="button" onClick={() => { setQuery(''); setPage(1); }} aria-label="Clear search">×</button>}</label><select aria-label="Sort contacts" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="email:asc">Email A–Z</option><option value="company:asc">Company A–Z</option></select></div></section>
    <section className="panel leads-table-panel"><div className="table-scroll"><table className="leads-table contacts-table"><thead><tr><th>CONTACT</th><th>COMPANY</th><th>EMAIL</th><th>PHONE</th><th>OWNER</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !contacts.length && Array.from({ length: 3 }, (_, index) => <tr className="lead-skeleton-row" key={`skeleton-${index}`}><td colSpan={6}><span /><span /><span /></td></tr>)}
      {!loading && contacts.map((contact) => <tr key={contact.id}><td className="lead-name-cell"><span className="module-record-mark contact-record-mark">{contact.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span><span className="contact-name-stack"><strong>{contact.name}</strong><small>{contact.title || 'Contact'}</small></span></td><td>{contact.company || '—'}</td><td><a className="contact-email" href={`mailto:${contact.email}`}>{contact.email}</a></td><td>{contact.phone || '—'}</td><td><span className="avatar avatar-owner">{contact.owner.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>{contact.owner}</td><td><div className="lead-row-actions"><button type="button" onClick={() => setDialogContact(contact)} aria-label={`Edit ${contact.name}`}>Edit</button><button type="button" onClick={() => void archive(contact)} aria-label={`Archive ${contact.name}`}>Archive</button></div></td></tr>)}
      {!loading && !error && !contacts.length && <tr><td colSpan={6}><div className="leads-empty"><span className="leads-empty-icon">◎</span><strong>{query ? 'No matching contacts' : 'No contacts yet'}</strong><p>{query ? 'Try a different name, company, email, or phone.' : 'Add your first contact to build your relationship directory.'}</p>{!query && <button className="button button-primary" type="button" onClick={() => setDialogContact(null)}>Add a contact</button>}</div></td></tr>}
    </tbody></table></div><div className="module-table-footer"><span>{loading ? 'Loading contacts' : `Showing ${contacts.length} of ${pageInfo.total} contacts`}</span><div className="table-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {Math.max(1, pageInfo.totalPages)}</span><button type="button" disabled={pageInfo.totalPages === 0 || page >= pageInfo.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div></section>
    {dialogContact !== undefined && <ContactDialog contact={dialogContact} close={() => setDialogContact(undefined)} saved={saved} />}
  </section>;
}
