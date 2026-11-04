'use client';

import { useEffect, useState } from 'react';
import NotificationPopover from './components/NotificationPopover';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import ProfileMenu from './components/ProfileMenu';
import ActionMenu from './components/ActionMenu';
import GlobalSearch from './components/GlobalSearch';
import HelpPopover from './components/HelpPopover';
import PipelineDistributionChart from './components/PipelineDistributionChart';
import MobileNavigation from './components/MobileNavigation';
import { SubscriptionExpiryBanner, WorkspaceAccessGate } from './components/WorkspaceAccessGate';
import { crmApiFetch } from '../lib/api-client';
import { fetchEnabledModules } from '../lib/module-permissions';

type DashboardDeal = {
  id: string;
  company: string;
  name: string;
  owner: string;
  stage: string;
  amount: number;
};

type DashboardData = {
  metrics: {
    totalLeads: number;
    openDeals: number;
    pipelineValue: number;
    wonDeals: number;
  };
  pipeline: { id: string; label: string; value: number; color: string }[];
  recentDeals: DashboardDeal[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!isRecord(value)) return false;
  const data = value;
  const metrics = data.metrics;
  const pipeline = data.pipeline;
  const recentDeals = data.recentDeals;
  return Boolean(
    isRecord(metrics) &&
    Number.isFinite(metrics.totalLeads) &&
    Number.isFinite(metrics.openDeals) &&
    Number.isFinite(metrics.pipelineValue) &&
    Number.isFinite(metrics.wonDeals) &&
    Array.isArray(pipeline) &&
    pipeline.every((value) =>
      isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.label === 'string' &&
      Number.isFinite(value.value) &&
      typeof value.color === 'string') &&
    Array.isArray(recentDeals) &&
    recentDeals.every((value) =>
      isRecord(value) &&
      typeof value.id === 'string' &&
      typeof value.company === 'string' &&
      typeof value.name === 'string' &&
      typeof value.owner === 'string' &&
      typeof value.stage === 'string' &&
      Number.isFinite(value.amount)),
  );
}

const navigation = [
  { label: "Overview", icon: "grid", active: true },
  { label: "Leads", icon: "users" },
  { label: "Contacts", icon: "contact" },
  { label: "Companies", icon: "building" },
  { label: "Deals", icon: "briefcase" },
  { label: "Activities", icon: "calendar" },
  { label: "Team", icon: "users" },
  { label: "Automation", icon: "sparkles" },
  { label: "Reports", icon: "chart" },
];

const formatCurrency = (value: number) => `$${value.toLocaleString("en-US")}`;

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    users: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm2 5a4 4 0 0 1 3 4v2m-1-15a4 4 0 0 1 0 8",
    contact: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    building: "M3 21h18M5 21V5l7-3 7 3v16M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01",
    briefcase: "M3 7h18v13H3zM8 7V4h8v3m-13 5h18m-11 0v2h4v-2",
    calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
    sparkles: "m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Zm7 12 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z",
    chart: "M3 3v18h18M8 15l4-4 4 3 5-7",
    coins: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Zm-8-3v5c0 1.7 3.6 3 8 3 1.5 0 2.9-.2 4.1-.5M4 10v5c0 1.7 3.6 3 8 3 .7 0 1.4 0 2-.1m-10-2v5c0 1.7 3.6 3 8 3m6-8c2.2 0 4-1.1 4-2.5S20.2 11 18 11s-4 1.1-4 2.5 1.8 2.5 4 2.5Zm-4-2.5V19c0 1.4 1.8 2.5 4 2.5s4-1.1 4-2.5v-5.5",
    trophy: "M8 21h8m-4-4v4m-6-18h12v5a6 6 0 0 1-12 0V3Zm0 2H3v2a5 5 0 0 0 5 5m8-7h5v2a5 5 0 0 1-5 5",
    search: "m21 21-4.3-4.3M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0",
    plus: "M12 5v14m-7-7h14",
    arrow: "M7 17 17 7M7 7h10v10",
    chevron: "m9 18 6-6-6-6",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d={paths[name] ?? paths.grid} />
    </svg>
  );
}

export default function Home() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [userName, setUserName] = useState('there');
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [moduleAccessError, setModuleAccessError] = useState('');

  useEffect(() => {
    const storedUser = sessionStorage.getItem('myr.user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser) as { name?: unknown };
        if (typeof user.name === 'string' && user.name.trim()) setUserName(user.name.trim().split(/\s+/)[0]);
      } catch {
        sessionStorage.removeItem('myr.user');
      }
    }

    const controller = new AbortController();
    void fetchEnabledModules(controller.signal)
      .then(setEnabledModules)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setModuleAccessError(error instanceof Error ? error.message : 'Could not load workspace module access.');
        }
      });
    async function loadDashboard() {
      try {
        const response = await crmApiFetch('/dashboard/summary', { signal: controller.signal });
        if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('json')) {
          throw new Error(`The dashboard API returned a non-JSON response (HTTP ${response.status}). Check that the API server is running and API_PROXY_URL points to it.`);
        }
        const payload = await response.json();
        if (!response.ok) {
          const error = payload?.error?.message;
          throw new Error(typeof error === 'string' ? error : 'Could not load dashboard data.');
        }
        if (!isDashboardData(payload?.data)) {
          throw new Error('The dashboard API returned an invalid response.');
        }
        setDashboard(payload.data);
        setDashboardError('');
      } catch (error) {
        if (controller.signal.aborted) return;
        setDashboardError(error instanceof Error ? error.message : 'Could not load dashboard data.');
      }
    }
    void loadDashboard();
    return () => controller.abort();
  }, []);

  const metrics = dashboard ? [
    { label: "Total leads", value: dashboard.metrics.totalLeads.toLocaleString(), icon: "users", tone: "mint" },
    { label: "Open deals", value: dashboard.metrics.openDeals.toLocaleString(), icon: "briefcase", tone: "peach" },
    { label: "Pipeline value", value: formatCurrency(dashboard.metrics.pipelineValue), icon: "coins", tone: "lavender" },
    { label: "Won deals", value: dashboard.metrics.wonDeals.toLocaleString(), icon: "trophy", tone: "yellow" },
  ] : [];
  const pipelineTotal = dashboard?.metrics.pipelineValue ?? 0;
  const largestPipelineStage = dashboard?.pipeline.reduce(
    (largest, stage) => stage.value > largest.value ? stage : largest,
    dashboard.pipeline[0],
  );

  return (
    <WorkspaceAccessGate>
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Myr CRM home">
          <span className="brand-mark">m</span>
          <span>myr<span className="brand-light">crm</span></span>
        </a>

        <WorkspaceSwitcher />

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.filter((item) => item.active || enabledModules.includes(item.label.toLowerCase())).map((item) => (
            <a
              className={`nav-item${item.active ? " active" : ""}`}
              href={item.active ? "/" : `/${item.label.toLowerCase()}`}
              key={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">✳</div>
            <strong>Need a hand?</strong>
            <p>Visit our help center to get started.</p>
            <HelpPopover />
          </div>
          <ProfileMenu />
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <MobileNavigation active="Overview" enabledModules={enabledModules} />
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron" />
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <SubscriptionExpiryBanner />
            <GlobalSearch />
            <NotificationPopover />
            <div className="preview-chip"><span /> {dashboard ? 'Live workspace' : 'Connecting'}</div>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <p className="date-label">WORKSPACE OVERVIEW</p>
              <h1>Welcome, {userName} <span>✦</span></h1>
              <p className="welcome-copy">Here&apos;s what&apos;s happening with your workspace today.</p>
            </div>
            <div className="welcome-actions">
              <a className="button button-secondary" href="/reports">
                <span className="button-icon">⌑</span> All time <span className="button-caret">↗</span>
              </a>
              <a className="button button-primary" href="/leads">
                <Icon name="plus" /> Add new lead
              </a>
            </div>
          </section>

          {moduleAccessError && <div className="demo-notice" role="alert"><span className="notice-dot" />{moduleAccessError}</div>}
          {dashboardError && <div className="demo-notice" role="alert"><span className="notice-dot" />{dashboardError}{dashboardError.toLowerCase().includes('token') || dashboardError.toLowerCase().includes('authenticated') ? <> · <a href="/sign-in">Sign in</a></> : null}</div>}

          <section className="metric-grid" aria-label="CRM summary">
            {metrics.length ? metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <span className={`metric-icon ${metric.tone}`}><Icon name={metric.icon} /></span>
                </div>
                <div className="metric-value">{metric.value}</div>
                <div className="metric-foot"><span>Current workspace</span></div>
              </article>
            )) : Array.from({ length: 4 }, (_, index) => <article className="metric-card" key={index}><div className="metric-top"><span>Loading summary</span></div><div className="metric-value">—</div></article>)}
          </section>

          <section className="dashboard-grid">
            <article className="panel pipeline-panel">
              <div className="panel-heading">
                <div>
                  <h2>Pipeline overview</h2>
                <p>How value is distributed across your sales stages</p>
                </div>
                <a className="select-button" href="/deals">All pipelines <span>↗</span></a>
              </div>
              <div className="pipeline-total">
                <strong>{formatCurrency(pipelineTotal)}</strong>
                <span className="muted-copy">open deal value</span>
              </div>
              <PipelineDistributionChart items={dashboard?.pipeline ?? []} />
              <div className="pipeline-footer">
                <span>{largestPipelineStage ? <><i className="legend-dot" /> Largest stage <b>{largestPipelineStage.label}</b> · {pipelineTotal ? ((largestPipelineStage.value / pipelineTotal) * 100).toFixed(1) : 0}% of total</> : 'No open deal value yet'}</span>
                <a href="/deals">View pipeline <Icon name="arrow" /></a>
              </div>
            </article>

            <article className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Recent changes across your workspace</p>
                </div>
                <ActionMenu label="More activity options" destination="/activities" copyText="Recent activity" />
              </div>
              <div className="activity-list"><p className="muted-copy">Activity history will appear here when the Activities module is connected.</p></div>
              <a className="panel-link" href="/activities">View all activity <Icon name="arrow" /></a>
            </article>
          </section>

          <section className="panel deals-panel" id="deals">
            <div className="panel-heading deals-heading">
              <div>
                <h2>Deals in progress</h2>
                <p>Keep an eye on your team&apos;s active opportunities</p>
              </div>
              <a className="text-link" href="/deals">View all deals <Icon name="arrow" /></a>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>COMPANY</th>
                    <th>DEAL NAME</th>
                    <th>OWNER</th>
                    <th>STAGE</th>
                    <th>AMOUNT</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(dashboard?.recentDeals ?? []).map((deal, index) => (
                    <tr key={deal.id}>
                      <td><span className={`company-avatar company-${["blue", "purple", "green", "orange"][index % 4]}`}>{deal.company.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><strong>{deal.company}</strong></td>
                      <td className="deal-name">{deal.name}</td>
                      <td><span className="avatar avatar-owner">{deal.owner.split(" ").map((part) => part[0]).join("")}</span>{deal.owner}</td>
                      <td><span className={`stage-pill stage-${deal.stage.toLowerCase()}`}>{deal.stage}</span></td>
                      <td className="amount-cell">{formatCurrency(deal.amount)}</td>
                      <td><ActionMenu label={`More options for ${deal.company}`} destination="/deals" copyText={deal.company} buttonClass="row-more" /></td>
                    </tr>
                  ))}
                  {dashboard && dashboard.recentDeals.length === 0 && <tr><td colSpan={6}>No open deals yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel tasks-panel" id="activities">
            <div className="panel-heading deals-heading">
              <div>
                <h2>Upcoming tasks</h2>
                <p>Your upcoming work</p>
              </div>
              <a className="text-link" href="/activities">View calendar <Icon name="arrow" /></a>
            </div>
            <div className="task-list"><p className="muted-copy">Tasks will appear here when the Activities module is connected.</p></div>
          </section>

          <footer className="page-footer">
            <span>MYR CRM <i /> Workspace overview</span>
            <span>{dashboard ? 'Live workspace data' : 'Waiting for workspace data'}</span>
          </footer>
        </div>
      </section>
    </main>
    </WorkspaceAccessGate>
  );
}
