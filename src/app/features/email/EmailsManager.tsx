"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { crmApiFetch } from "../../../lib/api-client";

type ContactOption = { id: string; name: string; email: string };
type EmailMessage = {
  id: string;
  contactId: string;
  contactName: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  deliveryStatus: "not_configured" | "queued" | "sent" | "failed";
  sentAt: string | null;
  createdByName: string;
  createdAt: string;
};

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Something went wrong. Please try again.";
  const error = payload as { error?: { message?: unknown }; message?: unknown };
  const message = error.error?.message ?? error.message;
  return typeof message === "string" ? message : "Something went wrong. Please try again.";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function EmailsManager() {
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotalPages, setContactTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(historyPage), pageSize: "25" });
        if (historyQuery.trim()) params.set("q", historyQuery.trim());
        const response = await crmApiFetch(`/emails?${params}`, { signal: controller.signal });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
          throw new Error("The CRM API returned an invalid email history.");
        }
        if (!cancelled) {
          setEmails(payload.data as EmailMessage[]);
          const meta = "meta" in payload && payload.meta && typeof payload.meta === "object"
            ? payload.meta as { totalPages?: unknown }
            : null;
          setHistoryTotalPages(typeof meta?.totalPages === "number" && meta.totalPages > 0 ? meta.totalPages : 1);
        }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Could not load email history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, historyQuery ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [historyPage, historyQuery, refresh]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setContactsLoading(true);
      try {
        const params = new URLSearchParams({ page: String(contactPage), pageSize: "25", sortBy: "name", sortOrder: "asc" });
        if (contactQuery.trim()) params.set("q", contactQuery.trim());
        const response = await crmApiFetch(`/contacts?${params}`, { signal: controller.signal });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
          throw new Error("The CRM API returned an invalid contact list.");
        }
        if (!cancelled) {
          const rows = payload.data as ContactOption[];
          setContacts((current) => contactPage === 1 ? rows : [...current, ...rows]);
          const meta = "meta" in payload && payload.meta && typeof payload.meta === "object"
            ? payload.meta as { totalPages?: unknown }
            : null;
          setContactTotalPages(typeof meta?.totalPages === "number" && meta.totalPages > 0 ? meta.totalPages : 1);
        }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Could not load contacts.");
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    }, contactQuery ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [contactPage, contactQuery, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const body = {
      contactId: selectedContact?.id ?? "",
      subject: String(formData.get("subject") ?? "").trim(),
      body: String(formData.get("body") ?? "").trim(),
    };
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await crmApiFetch("/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      form.reset();
      setSelectedContact(null);
      setContactQuery("");
      setContactPage(1);
      setHistoryPage(1);
      setNotice("Saved to the outbox. Email delivery is disabled.");
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this email.");
    } finally {
      setSaving(false);
    }
  }

  const contactOptions = selectedContact && !contacts.some((contact) => contact.id === selectedContact.id)
    ? [selectedContact, ...contacts]
    : contacts;

  return (
    <section className="email-feature">
      <div className="leads-page-heading">
        <div>
          <p className="date-label">WORKSPACE / EMAIL</p>
          <h1>Email</h1>
          <p className="welcome-copy">Save contact email drafts in the workspace outbox.</p>
        </div>
      </div>

      <div className="email-provider-notice" role="note">
        <strong>Email delivery is disabled</strong>
        <span>Messages are saved in the outbox only; nothing is sent to contacts.</span>
      </div>
      {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes("authenticated") || error.toLowerCase().includes("token") ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}

      <form className="panel email-compose" onSubmit={(event) => void submit(event)}>
        <div className="automation-form-heading">
          <div><h2>Save an email draft</h2><p>Choose an active contact and save a plain-text message to the outbox.</p></div>
        </div>
        <div className="email-compose-fields">
          <label htmlFor="email-contact-search">Find contact</label>
          <input
            id="email-contact-search"
            value={contactQuery}
            onChange={(event) => { setContactQuery(event.target.value); setContactPage(1); }}
            maxLength={120}
            placeholder="Search contacts by name, company, or email"
          />
          <label htmlFor="email-contact">To</label>
          <select
            id="email-contact"
            value={selectedContact?.id ?? ""}
            onChange={(event) => setSelectedContact(contacts.find((contact) => contact.id === event.target.value) ?? null)}
            required
          >
            <option value="">{contactsLoading ? "Loading contacts…" : "Choose a contact"}</option>
            {contactOptions.map((contact) => (
              <option key={contact.id} value={contact.id}>{contact.name} — {contact.email}</option>
            ))}
          </select>
          {contactPage < contactTotalPages && <button className="email-load-more" type="button" disabled={contactsLoading} onClick={() => setContactPage((value) => value + 1)}>{contactsLoading ? "Loading…" : "Load more contacts"}</button>}
          {!contactsLoading && contactOptions.length === 0 && <small>No contacts match. Add a contact first.</small>}
          <label htmlFor="email-subject">Subject</label>
          <input id="email-subject" name="subject" required maxLength={255} placeholder="A quick follow-up" />
          <label htmlFor="email-body">Message</label>
          <textarea id="email-body" name="body" required maxLength={20_000} rows={6} placeholder="Write your message…" />
        </div>
        <div className="email-compose-footer">
          <span>This CRM currently saves drafts and does not send email.</span>
          <button className="button button-primary" type="submit" disabled={saving || contactsLoading || !contacts.length || !selectedContact}>
            {saving ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>

      <section className="panel email-outbox" aria-label="Email outbox">
        <header className="automation-list-heading">
          <div><h2>Outbox</h2><p>{loading ? "Loading messages…" : `${emails.length} messages on page ${historyPage}`}</p></div>
          <span className="automation-secure-label">Organization scoped</span>
        </header>
        <label className="module-search email-history-search">
          <span aria-hidden="true">⌕</span>
          <input value={historyQuery} onChange={(event) => { setHistoryQuery(event.target.value); setHistoryPage(1); }} maxLength={120} placeholder="Search subject or recipient…" aria-label="Search email history" />
          {historyQuery && <button type="button" onClick={() => { setHistoryQuery(""); setHistoryPage(1); }} aria-label="Clear email search">×</button>}
        </label>
        {loading ? (
          <div className="automation-empty" role="status">Loading email history…</div>
        ) : emails.length === 0 ? (
          <div className="automation-empty"><span aria-hidden="true">✉</span><strong>No saved emails yet</strong><p>Compose a message to add it to this organization’s outbox.</p></div>
        ) : (
          <div className="email-outbox-list">
            {emails.map((email) => (
              <article className="email-outbox-item" key={email.id}>
                <div className="email-outbox-item-heading">
                  <div><h3>{email.subject}</h3><p>To {email.recipientName} &lt;{email.recipientEmail}&gt;</p></div>
                  <span className={`email-delivery-status status-${email.deliveryStatus}`}>
                    {email.deliveryStatus === "sent" ? "Sent" : email.deliveryStatus === "failed" ? "Delivery failed" : email.deliveryStatus === "queued" ? "Queued" : "Not sent"}
                  </span>
                </div>
                <pre>{email.body}</pre>
                <small>{email.deliveryStatus === "sent" && email.sentAt ? `Sent ${formatDate(email.sentAt)} · ` : ""}Saved by {email.createdByName} · {formatDate(email.createdAt)}</small>
              </article>
            ))}
          </div>
        )}
        {!loading && historyTotalPages > 1 && <div className="email-pagination"><button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((value) => value - 1)}>Previous</button><span>Page {historyPage} of {historyTotalPages}</span><button type="button" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((value) => value + 1)}>Next</button></div>}
      </section>
    </section>
  );
}
