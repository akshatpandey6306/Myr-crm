'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import RadarStageChart from '../../components/RadarStageChart';
import { crmApiFetch } from '../../../lib/api-client';

type Stage = { id: string; name: string; position: number };
type Pipeline = { id: string; name: string; isDefault: boolean; stages: Stage[] };
type CompanyOption = { id: string; name: string };
type Deal = {
  id: string; name: string; value: string; closeDate: string | null; status: 'open' | 'won' | 'lost';
  company: CompanyOption | null; pipeline: { id: string; name: string }; stage: Stage; owner: string;
};
type DealDraft = { name: string; value: string; closeDate: string | null; status: Deal['status']; companyId: string | null; pipelineId: string; stageId: string };
type ViewMode = 'board' | 'table' | 'radar';

function message(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Something went wrong. Please try again.';
  const data = payload as { error?: { message?: unknown }; message?: unknown };
  const value = data.error?.message ?? data.message;
  return typeof value === 'string' ? value : 'Something went wrong. Please try again.';
}

function currency(value: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function DealDialog({ deal, pipelines, companies, close, saved }: { deal: Deal | null; pipelines: Pipeline[]; companies: CompanyOption[]; close: () => void; saved: () => void }) {
  const initialPipelineId = deal?.pipeline.id ?? pipelines[0]?.id ?? '';
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const [stageId, setStageId] = useState(deal?.stage.id ?? pipelines.find((pipeline) => pipeline.id === initialPipelineId)?.stages[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stages = pipelines.find((pipeline) => pipeline.id === pipelineId)?.stages ?? [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedStageId = stages.some((stage) => stage.id === stageId) ? stageId : stages[0]?.id ?? '';
    const body: DealDraft = {
      name: String(form.get('name') ?? '').trim(),
      value: String(form.get('value') ?? '0').trim(),
      closeDate: String(form.get('closeDate') ?? '') || null,
      status: String(form.get('status') ?? 'open') as Deal['status'],
      companyId: String(form.get('companyId') ?? '') || null,
      pipelineId,
      stageId: selectedStageId,
    };
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch(deal ? `/deals/${deal.id}` : '/deals', {
        method: deal ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      saved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : cause instanceof Error ? cause.message : 'Could not save this deal.');
    } finally { setBusy(false); }
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="record-dialog deal-dialog" role="dialog" aria-modal="true" aria-labelledby="deal-dialog-title"><header><div><span className="auth-step">OPPORTUNITY DETAILS</span><h2 id="deal-dialog-title">{deal ? 'Edit deal' : 'Add a deal'}</h2><p>Track the value and next stage of this opportunity.</p></div><button type="button" aria-label="Close dialog" onClick={close} disabled={busy}>×</button></header><form onSubmit={submit}><div className="record-dialog-fields"><label>Deal name <span>required</span><input name="name" defaultValue={deal?.name ?? ''} autoFocus required maxLength={160} placeholder="e.g. Enterprise plan" /></label><label>Value <span>required</span><input type="number" name="value" defaultValue={deal?.value ?? '0'} min="0" max="9999999999.99" step="0.01" required /></label><label>Company<select name="companyId" defaultValue={deal?.company?.id ?? ''}><option value="">No company linked</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Close date<input type="date" name="closeDate" defaultValue={deal?.closeDate ?? ''} /></label><label>Pipeline<select name="pipelineId" value={pipelineId} onChange={(event) => { const nextPipelineId = event.target.value; setPipelineId(nextPipelineId); setStageId(pipelines.find((pipeline) => pipeline.id === nextPipelineId)?.stages[0]?.id ?? ''); }} required>{pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}</select></label><label>Stage<select name="stageId" value={stageId} onChange={(event) => setStageId(event.target.value)} required>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>Status<select name="status" defaultValue={deal?.status ?? 'open'}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select></label></div>{error && <p className="lead-form-error" role="alert">{error}</p>}<footer><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy || !pipelines.length}>{busy ? 'Saving…' : deal ? 'Save changes' : 'Create deal'}</button></footer></form></section></div>;
}

export default function DealsManager() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [pipelineId, setPipelineId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('createdAt:desc');
  const [view, setView] = useState<ViewMode>('board');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialogDeal, setDialogDeal] = useState<Deal | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const [stageFormOpen, setStageFormOpen] = useState(false);
  const [stageName, setStageName] = useState('');
  const [pipelineFormOpen, setPipelineFormOpen] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const [pipelinesResponse, companiesResponse] = await Promise.all([
          crmApiFetch('/pipelines', { signal: controller.signal }),
          crmApiFetch('/companies?pageSize=100&sortBy=name&sortOrder=asc', { signal: controller.signal }),
        ]);
        const [pipelinePayload, companyPayload] = await Promise.all([pipelinesResponse.json(), companiesResponse.json()]);
        if (!pipelinesResponse.ok) throw new Error(message(pipelinePayload));
        if (!companiesResponse.ok) throw new Error(message(companyPayload));
        const nextPipelines = Array.isArray(pipelinePayload.data) ? pipelinePayload.data as Pipeline[] : [];
        if (!cancelled) {
          setPipelines(nextPipelines);
          setCompanies(Array.isArray(companyPayload.data) ? companyPayload.data as CompanyOption[] : []);
          if (!pipelineId && nextPipelines.length) setPipelineId(nextPipelines.find((pipeline) => pipeline.isDefault)?.id ?? nextPipelines[0].id);
        }
      } catch (cause) {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Start the API server and try again.' : cause instanceof Error ? cause.message : 'Could not load pipelines.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [refresh]);

  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ pipelineId, page: '1', pageSize: '100' });
        if (query.trim()) params.set('q', query.trim());
        if (status) params.set('status', status);
        const [sortBy, sortOrder] = sort.split(':'); params.set('sortBy', sortBy); params.set('sortOrder', sortOrder);
        const response = await crmApiFetch(`/deals?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload));
        if (!cancelled) setDeals(Array.isArray(payload.data) ? payload.data as Deal[] : []);
      } catch (cause) {
        if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error && cause.message.includes('fetch') ? 'Could not reach the CRM API. Start the API server and try again.' : cause instanceof Error ? cause.message : 'Could not load deals.');
      } finally { if (!cancelled) setLoading(false); }
    }, query ? 220 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort(); };
  }, [pipelineId, query, status, sort, refresh]);

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === pipelineId);
  const stageSummary = useMemo(() => selectedPipeline?.stages.map((stage) => ({
    label: stage.name,
    value: deals.filter((deal) => deal.stage.id === stage.id).reduce((total, deal) => total + Number(deal.value), 0),
  })) ?? [], [selectedPipeline, deals]);
  const totalValue = deals.reduce((total, deal) => total + Number(deal.value), 0);

  async function refreshDeals() { setRefresh((value) => value + 1); }
  async function moveDeal(deal: Deal, stageId: string) {
    setError('');
    try {
      const response = await crmApiFetch(`/deals/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setNotice(`${deal.name} moved to ${selectedPipeline?.stages.find((stage) => stage.id === stageId)?.name}.`);
      await refreshDeals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move this deal.'); }
  }
  async function archive(deal: Deal) {
    if (!window.confirm(`Archive ${deal.name}? It will be removed from the active deals list.`)) return;
    try {
      const response = await crmApiFetch(`/deals/${deal.id}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setNotice(`${deal.name} was archived.`);
      await refreshDeals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive this deal.'); }
  }
  async function createStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPipeline) return;
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch(`/pipelines/${selectedPipeline.id}/stages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: stageName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setStageName(''); setStageFormOpen(false); setNotice(`Stage ${payload.data.name} added.`);
      await refreshDeals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this stage.'); }
    finally { setBusy(false); }
  }
  async function createPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await crmApiFetch('/pipelines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: pipelineName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload));
      setPipelineName(''); setPipelineFormOpen(false); setPipelineId(payload.data.id);
      setNotice(`${payload.data.name} pipeline created.`);
      await refreshDeals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this pipeline.'); }
    finally { setBusy(false); }
  }
  function saved() {
    const editing = Boolean(dialogDeal); setDialogDeal(undefined);
    setNotice(editing ? 'Deal changes saved.' : 'Deal created.');
    setRefresh((value) => value + 1);
  }

  return <section className="deals-feature">
    <div className="leads-page-heading"><div><p className="date-label">WORKSPACE / DEALS</p><h1>Deals</h1><p className="welcome-copy">Track opportunities and keep your pipeline moving forward.</p></div><button className="button button-primary" type="button" onClick={() => setDialogDeal(null)} disabled={!pipelines.length}><span aria-hidden="true">＋</span> Add deal</button></div>
    {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('token') || error.toLowerCase().includes('authenticated') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}
    <section className="deal-metric-row" aria-label="Pipeline summary"><article className="metric-card"><div className="metric-top"><span>Open opportunities</span><span className="metric-icon mint">◇</span></div><div className="metric-value">{deals.filter((deal) => deal.status === 'open').length}</div><div className="metric-foot"><span>In this pipeline</span></div></article><article className="metric-card"><div className="metric-top"><span>Pipeline value</span><span className="metric-icon lavender">↗</span></div><div className="metric-value">{currency(String(totalValue))}</div><div className="metric-foot"><span>Across {deals.length} visible deals</span></div></article><article className="metric-card"><div className="metric-top"><span>Stages</span><span className="metric-icon peach">▦</span></div><div className="metric-value">{selectedPipeline?.stages.length ?? 0}</div><div className="metric-foot"><span>{selectedPipeline?.name ?? 'Loading pipeline'}</span></div></article></section>
    <section className="deal-workspace panel"><div className="deal-toolbar"><div className="deal-toolbar-leading"><label className="deal-pipeline-select">Pipeline<select aria-label="Select pipeline" value={pipelineId} onChange={(event) => setPipelineId(event.target.value)}>{pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? ' · Default' : ''}</option>)}</select></label><div className="view-toggle" aria-label="Choose deals view"><button type="button" className={view === 'board' ? 'active' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button><button type="button" className={view === 'radar' ? 'active' : ''} aria-pressed={view === 'radar'} onClick={() => setView('radar')}>Value</button><button type="button" className={view === 'table' ? 'active' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>List</button></div></div><div className="deal-filters"><label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search deals…" aria-label="Search deals" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label><select aria-label="Filter by deal status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></select><select aria-label="Sort deals" value={sort} onChange={(event) => setSort(event.target.value)}><option value="createdAt:desc">Newest first</option><option value="value:desc">Value high–low</option><option value="closeDate:asc">Close date</option><option value="name:asc">Name A–Z</option></select></div></div>
      <div className="deal-workspace-heading"><div><h2>{selectedPipeline?.name ?? 'Sales pipeline'}</h2><p>{loading ? 'Updating deals…' : `${deals.length} deals · ${currency(String(totalValue))} total value`}</p></div><div className="deal-config-actions"><button type="button" className="deal-secondary-button" onClick={() => { setPipelineFormOpen((open) => !open); setStageFormOpen(false); }}>＋ Pipeline</button><button type="button" className="deal-secondary-button" onClick={() => { setStageFormOpen((open) => !open); setPipelineFormOpen(false); }} disabled={!selectedPipeline}>＋ Stage</button></div></div>
      {pipelineFormOpen && <form className="deal-inline-form" onSubmit={(event) => void createPipeline(event)}><label>New pipeline name<input value={pipelineName} onChange={(event) => setPipelineName(event.target.value)} required maxLength={120} placeholder="e.g. Renewals" /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create pipeline'}</button></form>}
      {stageFormOpen && <form className="deal-inline-form" onSubmit={(event) => void createStage(event)}><label>New stage name<input value={stageName} onChange={(event) => setStageName(event.target.value)} required maxLength={80} placeholder="e.g. Legal review" /></label><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add stage'}</button></form>}
      {view === 'radar' ? <div className="deal-radar-panel"><RadarStageChart items={stageSummary} /></div> : view === 'board' ? <div className="deal-board-scroll" aria-label="Deal pipeline board"><div className="deal-board">{selectedPipeline?.stages.map((stage, index) => {
        const stageDeals = deals.filter((deal) => deal.stage.id === stage.id);
        return <section className={`deal-lane deal-lane-tone-${index % 4}`} key={stage.id}><header><div><strong>{stage.name}</strong><small>{stageDeals.length} {stageDeals.length === 1 ? 'deal' : 'deals'}</small></div><b>{currency(String(stageDeals.reduce((total, deal) => total + Number(deal.value), 0)))}</b></header><div className="deal-lane-cards">{stageDeals.map((deal) => <article className="deal-card" key={deal.id}><span className="deal-card-company">{deal.company?.name ?? 'No company linked'}</span><strong>{deal.name}</strong><div className="deal-card-value">{currency(deal.value)}</div><div className="deal-card-meta"><span>{deal.closeDate ? `Close ${new Date(`${deal.closeDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No close date'}</span><span>{deal.owner}</span></div><div className="deal-card-actions"><label>Move<select value={deal.stage.id} onChange={(event) => void moveDeal(deal, event.target.value)} aria-label={`Move ${deal.name} to stage`}>{selectedPipeline?.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label><button type="button" onClick={() => setDialogDeal(deal)}>Edit</button></div></article>)}</div>{!stageDeals.length && <p className="deal-lane-empty">No deals in this stage</p>}</section>;
      })}</div></div> : <div className="table-scroll"><table className="leads-table deal-table"><thead><tr><th>DEAL</th><th>COMPANY</th><th>STAGE</th><th>VALUE</th><th>CLOSE DATE</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{deals.map((deal) => <tr key={deal.id}><td className="lead-name-cell">{deal.name}</td><td>{deal.company?.name ?? '—'}</td><td>{deal.stage.name}</td><td>{currency(deal.value)}</td><td>{deal.closeDate ?? '—'}</td><td><span className={`deal-status-pill deal-status-${deal.status}`}>{deal.status}</span></td><td><div className="lead-row-actions"><button type="button" onClick={() => setDialogDeal(deal)}>Edit</button><button type="button" onClick={() => void archive(deal)}>Archive</button></div></td></tr>)}{!loading && deals.length === 0 && <tr><td className="module-empty" colSpan={7}>{query ? `No deals match “${query}”.` : 'No deals in this pipeline yet. Add your first deal to get started.'}</td></tr>}</tbody></table></div>}
      {view !== 'table' && !loading && deals.length === 0 && <p className="deal-board-empty">{query ? `No deals match “${query}”.` : 'No deals match the selected filters.'}</p>}
      <div className="module-table-footer"><span>{deals.length} visible deals</span><span>Changes are saved to this workspace</span></div>
    </section>
    {dialogDeal !== undefined && <DealDialog deal={dialogDeal} pipelines={pipelines} companies={companies} close={() => setDialogDeal(undefined)} saved={saved} />}
  </section>;
}
