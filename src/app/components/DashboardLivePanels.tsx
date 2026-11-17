'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ActionMenu from './ActionMenu';
import PipelineDistributionChart from './PipelineDistributionChart';
import PieBarChart from './PieBarChart';
import { crmApiFetch } from '../../lib/api-client';
import { useWorkspaceModuleAccess } from './WorkspaceModuleAccess';

type Summary = {
  metrics: {
    totalLeads: number;
    openDeals: number;
    openPipelineValue: string;
    wonRevenue: string;
    openActivities: number;
    completedActivities: number;
  };
  dealsByStatus: Array<{ status: string; count: number; value: string }>;
  leadsByStatus: Array<{ status: string; count: number }>;
};

type Deal = {
  id: string;
  name: string;
  value: string;
  company: { name: string } | null;
  stage: { name: string };
  owner: string;
};

type Activity = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  createdByName: string;
  assignedToName: string | null;
  relatedToName: string | null;
};

type DashboardData = {
  summary: Summary;
  deals: Deal[];
  recentActivities: Activity[];
  upcomingActivities: Activity[];
};

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'Could not load dashboard data.';
  const result = payload as { error?: { message?: unknown }; message?: unknown };
  const message = result.error?.message ?? result.message;
  return typeof message === 'string' ? message : 'Could not load dashboard data.';
}

function currency(value: string | number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '—';
}

function dateLabel(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No due date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

async function getData<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await crmApiFetch(path, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(errorMessage(payload));
  return payload as T;
}

export default function DashboardLivePanels() {
  const enabledModules = useWorkspaceModuleAccess();
  const modulesReady = enabledModules !== null;
  const leadsEnabled = enabledModules?.includes('leads') ?? false;
  const dealsEnabled = enabledModules?.includes('deals') ?? false;
  const activitiesEnabled = enabledModules?.includes('activities') ?? false;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      if (!modulesReady) return;
      setLoading(true);
      setError('');
      const [summaryResult, dealsResult, recentResult, upcomingResult] = await Promise.allSettled([
        getData<{ data: Summary }>('/dashboard/summary', controller.signal),
        dealsEnabled ? getData<{ data: Deal[] }>('/deals?status=open&page=1&pageSize=5&sortBy=createdAt&sortOrder=desc', controller.signal) : Promise.resolve({ data: [] as Deal[] }),
        activitiesEnabled ? getData<{ data: Activity[] }>('/activities?page=1&pageSize=4&sortBy=createdAt&sortOrder=desc', controller.signal) : Promise.resolve({ data: [] as Activity[] }),
        activitiesEnabled ? getData<{ data: Activity[] }>('/activities?status=open&page=1&pageSize=4&sortBy=dueAt&sortOrder=asc', controller.signal) : Promise.resolve({ data: [] as Activity[] }),
      ]);
      if (!active || controller.signal.aborted) return;
      const emptySummary: Summary = { metrics: { totalLeads: 0, openDeals: 0, openPipelineValue: '0', wonRevenue: '0', openActivities: 0, completedActivities: 0 }, dealsByStatus: [], leadsByStatus: [] };
      const firstFailure = [summaryResult, dealsResult, recentResult, upcomingResult].find((result) => result.status === 'rejected');
      const reason = firstFailure?.status === 'rejected' ? firstFailure.reason : null;
      setData({
        summary: summaryResult.status === 'fulfilled' ? summaryResult.value.data : emptySummary,
        deals: dealsResult.status === 'fulfilled' ? dealsResult.value.data : [],
        recentActivities: recentResult.status === 'fulfilled' ? recentResult.value.data : [],
        upcomingActivities: upcomingResult.status === 'fulfilled' ? upcomingResult.value.data : [],
      });
      if (reason) setError(reason instanceof Error && reason.message.includes('fetch') ? 'Could not reach the CRM API. Check that the API server is running.' : reason instanceof Error ? reason.message : 'Some overview data could not be loaded.');
      setLoading(false);
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [activitiesEnabled, dealsEnabled, modulesReady, refresh]);

  useEffect(() => {
    const refreshDemoData = () => setRefresh((value) => value + 1);
    window.addEventListener('myr:demo-data-changed', refreshDemoData);
    window.addEventListener('myr:organization-changed', refreshDemoData);
    return () => {
      window.removeEventListener('myr:demo-data-changed', refreshDemoData);
      window.removeEventListener('myr:organization-changed', refreshDemoData);
    };
  }, []);

  const metrics = data?.summary.metrics;
  const dealOutcomes = data?.summary.dealsByStatus ?? [];
  const totalValue = dealOutcomes.reduce((total, item) => total + Number(item.value || 0), 0);
  const largestOutcome = dealOutcomes.reduce<(typeof dealOutcomes)[number] | null>(
    (largest, item) => !largest || Number(item.value) > Number(largest.value) ? item : largest,
    null,
  );
  const outcomeColors: Record<string, string> = { open: '#3678D4', won: '#24936F', lost: '#E56F4A' };
  const metricCards = [
    ...(leadsEnabled ? [
    { label: 'Total leads', value: loading ? '…' : String(metrics?.totalLeads ?? 0), note: 'Active workspace leads', icon: 'users', tone: 'mint' },
    ] : []),
    ...(dealsEnabled ? [
    { label: 'Open deals', value: loading ? '…' : String(metrics?.openDeals ?? 0), note: 'Active opportunities', icon: 'briefcase', tone: 'peach' },
    { label: 'Pipeline value', value: loading ? '…' : currency(metrics?.openPipelineValue ?? 0), note: 'Value of open deals', icon: 'coins', tone: 'lavender' },
    { label: 'Won revenue', value: loading ? '…' : currency(metrics?.wonRevenue ?? 0), note: 'Value of won deals', icon: 'trophy', tone: 'yellow' },
    ] : []),
  ];

  if (!modulesReady) return null;
  const showDealPanels = dealsEnabled;
  const showActivityPanel = activitiesEnabled;

  return <>
    {error && <div className="leads-error" role="alert"><span>{error}</span>{error.toLowerCase().includes('authenticated') || error.toLowerCase().includes('token') ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}

    {metricCards.length > 0 && <section className="metric-grid" aria-label="CRM summary" aria-busy={loading}>
      {metricCards.map((metric) => <article className="metric-card" key={metric.label}>
        <div className="metric-top"><span>{metric.label}</span><span className={`metric-icon ${metric.tone}`} aria-hidden="true">{metric.icon === 'users' ? '♙' : metric.icon === 'briefcase' ? '▣' : metric.icon === 'coins' ? '$' : '★'}</span></div>
        <div className="metric-value">{metric.value}</div>
        <div className="metric-foot"><span>{metric.note}</span></div>
      </article>)}
    </section>}

    {(showDealPanels || showActivityPanel) && <section className={`dashboard-grid${showDealPanels && showActivityPanel ? '' : ' dashboard-grid-single-panel'}`}>
      {showDealPanels && <article className="panel pipeline-panel">
        <div className="panel-heading"><div><h2>Deal value by status</h2><p>Live value across your open and closed deals</p></div><a className="select-button" href="/deals">All deals <span>↗</span></a></div>
        <div className="pipeline-total"><strong>{loading ? '…' : currency(totalValue)}</strong><span className="muted-copy">total deal value</span></div>
        <PipelineDistributionChart items={dealOutcomes.map((item) => ({ label: item.status.replace(/\b\w/g, (letter) => letter.toUpperCase()), value: Number(item.value), color: outcomeColors[item.status] ?? '#8254C7' }))} />
        <div className="pipeline-footer"><span>{largestOutcome ? <>Largest category <b>{largestOutcome.status}</b> · {totalValue ? `${((Number(largestOutcome.value) / totalValue) * 100).toFixed(1)}%` : '0%'} of total</> : 'No deal data yet'}</span><a href="/deals">View deals <span aria-hidden="true">↗</span></a></div>
      </article>}

      {showActivityPanel && <article className="panel activity-panel">
        <div className="panel-heading"><div><h2>Recent activities</h2><p>Latest activities recorded in this workspace</p></div><ActionMenu label="More activity options" destination="/activities" copyText="Recent activities" /></div>
        <div className="activity-list" aria-busy={loading}>
          {data?.recentActivities.map((activity) => <div className="activity-item" key={activity.id}>
            <span className="avatar avatar-blue">{initials(activity.createdByName)}</span>
            <div className="activity-copy"><p><strong>{activity.createdByName}</strong> added a {activity.type.replaceAll('_', ' ')} <b>{activity.title}</b>{activity.relatedToName ? <> for <b>{activity.relatedToName}</b></> : null}</p><span>{dateLabel(activity.createdAt)}</span></div>
          </div>)}
          {!loading && !error && !data?.recentActivities.length && <p className="muted-copy">No activities recorded yet.</p>}
          {loading && <p className="muted-copy">Loading activities…</p>}
        </div>
        <a className="panel-link" href="/activities">View all activities <span aria-hidden="true">↗</span></a>
      </article>}
    </section>}

    {leadsEnabled && <PieBarChart title="Lead status distribution" unit="leads" items={(data?.summary.leadsByStatus ?? []).map((item) => ({ label: item.status.replace(/\b\w/g, (letter) => letter.toUpperCase()), value: item.count, color: ({ new: '#477dd0', contacted: '#dd9b37', qualified: '#27976f', disqualified: '#cf5b64' } as Record<string, string>)[item.status] ?? '#8164ce' }))} />}

    {showDealPanels && <section className="panel deals-panel" id="deals">
      <div className="panel-heading deals-heading"><div><h2>Deals in progress</h2><p>{loading ? 'Loading open deals…' : `${metrics?.openDeals ?? 0} open deals in this workspace`}</p></div><a className="text-link" href="/deals">View all deals <span aria-hidden="true">↗</span></a></div>
      <div className="table-scroll"><table><thead><tr><th>COMPANY</th><th>DEAL NAME</th><th>OWNER</th><th>STAGE</th><th>AMOUNT</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data?.deals.map((deal) => <tr key={deal.id}>
          <td><span className="company-avatar company-blue">{initials(deal.company?.name ?? deal.name)}</span><strong>{deal.company?.name ?? 'No company'}</strong></td>
          <td className="deal-name">{deal.name}</td>
          <td><span className="avatar avatar-owner">{initials(deal.owner)}</span>{deal.owner}</td>
          <td><span className={`stage-pill stage-${deal.stage.name.toLowerCase()}`}>{deal.stage.name}</span></td>
          <td className="amount-cell">{currency(deal.value)}</td>
          <td><ActionMenu label={`More options for ${deal.name}`} destination="/deals" copyText={deal.name} buttonClass="row-more" /></td>
        </tr>)}</tbody>
      </table>{!loading && !error && !data?.deals.length && <p className="muted-copy">No open deals yet.</p>}</div>
    </section>}

    {activitiesEnabled && <section className="panel tasks-panel" id="activities">
      <div className="panel-heading deals-heading"><div><h2>Upcoming activities</h2><p>{loading ? 'Loading open activities…' : `${metrics?.openActivities ?? 0} open or in-progress activities`}</p></div><a className="text-link" href="/activities">View activities <span aria-hidden="true">↗</span></a></div>
      <div className="task-list" aria-busy={loading}>{data?.upcomingActivities.map((activity) => <div className="task-item" key={activity.id}>
        <span className="task-check" aria-hidden="true" /><div className="task-copy"><strong>{activity.title}</strong><span>{dateLabel(activity.dueAt)}{activity.assignedToName ? ` · ${activity.assignedToName}` : ''}</span></div><span className={`task-tag task-${activity.type.toLowerCase()}`}>{activity.type.replace(/\b\w/g, (letter) => letter.toUpperCase())}</span><ActionMenu label={`More options for ${activity.title}`} destination="/activities" copyText={activity.title} buttonClass="row-more" />
      </div>)}{!loading && !error && !data?.upcomingActivities.length && <p className="muted-copy">No open activities yet.</p>}</div>
    </section>}
  </>;
}
