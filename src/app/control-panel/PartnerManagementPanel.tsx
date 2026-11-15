'use client';

import { FormEvent, useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Partner = { id: string; name: string; enabled: boolean; permissions: string[]; plansUrl: string | null; webhookUrl: string | null; hasWebhookSecret: boolean; apiKeys: Array<{ id: string; keyPrefix: string; permissions: string[]; active: boolean; lastUsedAt: string | null; createdAt: string }>; _count: { mappings: number; webhookEvents: number } };
type Customer = { partner: { id: string; name: string }; externalCustomerRef: string; email: string; organization: { id: string; name: string; slug: string | null; subscriptionStatus: string; subscriptionPlan: string | null; subscriptionEndsAt: string | null; memberships: Array<{ user: { name: string; email: string } }> }; createdAt: string };
type Event = { id: string; partnerId: string; externalEventId: string; eventType: string; organizationId: string | null; outcome: string; createdAt: string };
type UsageLog = { id: string; partnerId: string; apiKeyId: string; operation: string; createdAt: string };
type SecretResult = { apiKey: string; webhookSigningSecret?: string; secretsShownOnce: true };
const permissions = ['provision', 'customers:read', 'subscriptions:write'];

function record(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }

export default function PartnerManagementPanel() {
  const [partners, setPartners] = useState<Partner[]>([]); const [customers, setCustomers] = useState<Customer[]>([]); const [events, setEvents] = useState<Event[]>([]); const [usage, setUsage] = useState<UsageLog[]>([]);
  const [name, setName] = useState(''); const [webhookUrl, setWebhookUrl] = useState(''); const [plansUrl, setPlansUrl] = useState('');
  const [selected, setSelected] = useState<string[]>(permissions); const [secrets, setSecrets] = useState<SecretResult | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const responses = await Promise.all(['/control-panel/partners', '/control-panel/partners/customers', '/control-panel/partners/events', '/control-panel/partners/usage'].map((path) => crmApiFetch(path)));
      const payloads = await Promise.all(responses.map((response) => response.json()));
      for (let i = 0; i < responses.length; i++) if (!responses[i]!.ok) throw new Error(typeof record(record(payloads[i]).error).message === 'string' ? String(record(record(payloads[i]).error).message) : 'Could not load partner integration data.');
      setPartners(Array.isArray(record(payloads[0]).data) ? record(payloads[0]).data as Partner[] : []);
      setCustomers(Array.isArray(record(payloads[1]).data) ? record(payloads[1]).data as Customer[] : []);
      setEvents(Array.isArray(record(payloads[2]).data) ? record(payloads[2]).data as Event[] : []);
      setUsage(Array.isArray(record(payloads[3]).data) ? record(payloads[3]).data as UsageLog[] : []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load partner integration data.'); }
  }
  useEffect(() => { void load(); }, []);

  async function send(path: string, method: string, body?: unknown) {
    const response = await crmApiFetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const payload = await response.json(); const apiError = record(record(payload).error); if (!response.ok) throw new Error(typeof apiError.message === 'string' ? apiError.message : 'Partner integration request failed.');
    return record(payload).data;
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = record(await send('/control-panel/partners', 'POST', { name, webhookUrl: webhookUrl || null, plansUrl: plansUrl || null, permissions: selected }));
      setSecrets({ apiKey: String(result.apiKey), webhookSigningSecret: String(result.webhookSigningSecret), secretsShownOnce: true });
      setName(''); setWebhookUrl(''); setPlansUrl(''); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create partner.'); } finally { setBusy(false); }
  }
  async function runAction(path: string, method = 'POST', body?: unknown, secret = false) {
    setBusy(true); setError(''); setSecrets(null);
    try { const result = record(await send(path, method, body)); if (secret && (typeof result.apiKey === 'string' || typeof result.webhookSigningSecret === 'string')) setSecrets({ apiKey: typeof result.apiKey === 'string' ? result.apiKey : 'No API key issued by this action.', ...(typeof result.webhookSigningSecret === 'string' ? { webhookSigningSecret: result.webhookSigningSecret } : {}), secretsShownOnce: true }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Partner action failed.'); } finally { setBusy(false); }
  }
  async function savePartnerUrl(partner: Partner, field: 'webhookUrl' | 'plansUrl', value: string) {
    setPartners((current) => current.map((item) => item.id === partner.id ? { ...item, [field]: value || null } : item));
    await runAction(`/control-panel/partners/${partner.id}`, 'PATCH', { [field]: value || null });
  }
  return <div className="control-panel-section-stack">
    {error && <p className="control-panel-error" role="alert">{error}</p>}
    {secrets && <section className="panel" aria-live="polite"><h2>Copy these credentials now</h2><p>They are shown only once. Store them in your partner server’s secret manager; never put them in browser code.</p>{secrets.apiKey !== 'No API key issued by this action.' && <label>Partner API key<output style={{ display: 'block', overflowWrap: 'anywhere' }}>{secrets.apiKey}</output></label>}{secrets.webhookSigningSecret && <label>Webhook signing secret<output style={{ display: 'block', overflowWrap: 'anywhere' }}>{secrets.webhookSigningSecret}</output></label>}</section>}
    <section className="panel control-panel-onboarding"><h2>Create integration partner</h2><form className="control-panel-onboarding-form" onSubmit={(event) => void create(event)}>
      <label>Partner name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Partner website" /></label>
      <label>Webhook URL (optional)<input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://partner.example/webhooks/crm" /></label>
      <label>Plans URL (optional)<input type="url" value={plansUrl} onChange={(event) => setPlansUrl(event.target.value)} placeholder="https://partner.example/plans" /></label>
      <fieldset><legend>API permissions</legend>{permissions.map((permission) => <label key={permission}><input type="checkbox" checked={selected.includes(permission)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, permission] : current.filter((item) => item !== permission))} /> {permission}</label>)}</fieldset>
      <button className="control-panel-action primary" type="submit" disabled={busy || !selected.length}>{busy ? 'Creating…' : 'Create partner and key'}</button>
    </form></section>
    <section className="panel control-panel-table"><h2>Partners</h2>{partners.length ? <div className="table-scroll"><table><thead><tr><th>Partner</th><th>Permissions</th><th>Keys</th><th>Customers</th><th>Webhook events</th><th>Actions</th></tr></thead><tbody>{partners.map((partner) => <tr key={partner.id}><td>{partner.name}<br /><small>{partner.enabled ? 'Enabled' : 'Disabled'}</small><label>Webhook URL<input key={`${partner.id}:webhook:${partner.webhookUrl ?? ''}`} type="url" defaultValue={partner.webhookUrl ?? ''} onBlur={(event) => { if (event.currentTarget.value !== (partner.webhookUrl ?? '')) void savePartnerUrl(partner, 'webhookUrl', event.currentTarget.value); }} /></label><label>Plans URL<input key={`${partner.id}:plans:${partner.plansUrl ?? ''}`} type="url" defaultValue={partner.plansUrl ?? ''} onBlur={(event) => { if (event.currentTarget.value !== (partner.plansUrl ?? '')) void savePartnerUrl(partner, 'plansUrl', event.currentTarget.value); }} /></label></td><td>{partner.permissions.join(', ')}<br /><button className="control-panel-action" disabled={busy} onClick={() => void runAction(`/control-panel/partners/${partner.id}`, 'PATCH', { permissions: selected })}>Apply selected permissions</button></td><td>{partner.apiKeys.map((key) => <p key={key.id}>{key.keyPrefix} · {key.active ? 'active' : 'revoked'}{key.active && <button className="control-panel-action" disabled={busy} onClick={() => void runAction(`/control-panel/partners/${partner.id}/keys/${key.id}/revoke`)}>Revoke</button>}</p>)}</td><td>{partner._count.mappings}</td><td>{partner._count.webhookEvents}</td><td><button className="control-panel-action" disabled={busy} onClick={() => void runAction(`/control-panel/partners/${partner.id}/keys/rotate`, 'POST', undefined, true)}>Rotate key</button><button className="control-panel-action" disabled={busy} onClick={() => void runAction(`/control-panel/partners/${partner.id}/webhook-secret/rotate`, 'POST', undefined, true)}>Rotate webhook secret</button> <button className="control-panel-action" disabled={busy} onClick={() => void runAction(`/control-panel/partners/${partner.id}/status`, 'POST', { enabled: !partner.enabled })}>{partner.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div> : <p>No integration partners configured.</p>}</section>
    <section className="panel control-panel-table"><h2>Partner-provisioned customers</h2><div className="table-scroll"><table><thead><tr><th>Partner / external ref</th><th>Owner</th><th>Workspace</th><th>Subscription</th><th>Provisioned</th></tr></thead><tbody>{customers.map((item) => <tr key={`${item.partner.id}:${item.externalCustomerRef}`}><td>{item.partner.name}<br />{item.externalCustomerRef}</td><td>{item.organization.memberships[0]?.user.name}<br />{item.email}</td><td>{item.organization.name}<br /><small>{item.organization.slug}</small></td><td>{item.organization.subscriptionStatus} · {item.organization.subscriptionPlan ?? '—'}{item.organization.subscriptionEndsAt && <><br />Ends {new Date(item.organization.subscriptionEndsAt).toLocaleString()}</>}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
    <section className="panel control-panel-table"><h2>Recent partner API usage</h2><div className="table-scroll"><table><thead><tr><th>Partner</th><th>Key prefix</th><th>Operation</th><th>Time</th></tr></thead><tbody>{usage.map((item) => <tr key={item.id}><td>{partners.find((partner) => partner.id === item.partnerId)?.name ?? item.partnerId}</td><td>{partners.flatMap((partner) => partner.apiKeys).find((key) => key.id === item.apiKeyId)?.keyPrefix ?? 'revoked key'}</td><td>{item.operation}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
    <section className="panel control-panel-table"><h2>Recent partner webhook events</h2><div className="table-scroll"><table><thead><tr><th>Type</th><th>Event ID</th><th>Organization</th><th>Outcome</th><th>Received</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{event.eventType}</td><td>{event.externalEventId}</td><td>{event.organizationId ?? '—'}</td><td>{event.outcome}</td><td>{new Date(event.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
  </div>;
}
