'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState } from 'react';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import ProfileMenu from '../components/ProfileMenu';
import NotificationPopover from '../components/NotificationPopover';
import CreateRecordDialog from '../components/CreateRecordDialog';
import GlobalSearch from '../components/GlobalSearch';
import HelpPopover from '../components/HelpPopover';
import RadialBarChart from '../components/RadialBarChart';
import NightingaleChart from '../components/NightingaleChart';
import RadarStageChart from '../components/RadarStageChart';
import type { DistributionDatum } from '../components/chart-types';
import MobileNavigation from '../components/MobileNavigation';
import LeadsManager from '../features/leads/LeadsManager';
import ContactsManager from '../features/contacts/ContactsManager';
import CompaniesManager from '../features/companies/CompaniesManager';
import VendorsManager from '../features/vendors/VendorsManager';
import DealsManager from '../features/deals/DealsManager';
import AutomationsManager from '../features/automation/AutomationsManager';
import EmailsManager from '../features/email/EmailsManager';
import ReportsManager from '../features/reports/ReportsManager';
import AuditLogsManager from '../features/audit-logs/AuditLogsManager';
import SettingsManager from '../features/settings/SettingsManager';
import MembersManager from '../features/team/MembersManager';
import BillingManager from '../features/billing-invoicing/BillingManager';
import { fetchEnabledModules } from '../../lib/module-permissions';

const navigation = [
  ['Overview', '/'], ['Leads', '/leads'], ['Contacts', '/contacts'],
  ['Companies', '/companies'], ['Deals', '/deals'], ['Vendors', '/vendors'], ['Billing & Invoicing', '/billing-invoicing'], ['Activities', '/activities'],
  ['Automation', '/automation'], ['Email', '/email'], ['Reports', '/reports'],
  ['Audit Logs', '/audit-logs'], ['Settings', '/settings'], ['Team', '/team'],
];

const dealStages = [
  { name: 'Discovery', tone: 'blue' }, { name: 'Qualified', tone: 'green' },
  { name: 'Proposal', tone: 'orange' }, { name: 'Negotiation', tone: 'purple' },
];

const moduleCharts: Record<string, { index: number; dimension: string; kind: 'radial' | 'nightingale' }> = {
  Leads: { index: 2, dimension: 'Leads by source', kind: 'radial' },
  Activities: { index: 4, dimension: 'Activities by status', kind: 'nightingale' },
};

const distributionColors = ['#3678D4', '#8254C7', '#E56F4A', '#24936F', '#D0A12E', '#D65383'];

const records: Record<string, { title: string; label: string; columns: string[]; rows: string[][]; metric: string }> = {
  leads: { title: 'Leads', label: 'Manage prospects from first touch to qualified opportunity.', columns: ['NAME', 'COMPANY', 'SOURCE', 'STATUS', 'OWNER'], metric: '24 active leads', rows: [['Olivia Rhye', 'Northstar Labs', 'Website', 'Qualified', 'Maya Chen'], ['Phoenix Baker', 'Forma Studio', 'Referral', 'Contacted', 'Jordan Lee'], ['Lana Steiner', 'Greenway Co.', 'LinkedIn', 'New', 'Alex Morgan'], ['Demi Wilkinson', 'Kinfield Group', 'Website', 'In progress', 'Maya Chen']] },
  contacts: { title: 'Contacts', label: 'Keep every customer relationship organized in one place.', columns: ['CONTACT', 'COMPANY', 'EMAIL', 'PHONE', 'LAST CONTACT'], metric: '186 contacts', rows: [['Olivia Rhye', 'Northstar Labs', 'olivia@northstar.io', '+1 415 555 0134', 'Today'], ['Phoenix Baker', 'Forma Studio', 'phoenix@forma.co', '+1 415 555 0182', 'Yesterday'], ['Lana Steiner', 'Greenway Co.', 'lana@greenway.co', '+1 415 555 0117', 'Oct 24'], ['Demi Wilkinson', 'Kinfield Group', 'demi@kinfield.com', '+1 415 555 0164', 'Oct 22']] },
  companies: { title: 'Companies', label: 'See the organizations your team is building relationships with.', columns: ['COMPANY', 'INDUSTRY', 'CONTACTS', 'OPEN DEALS', 'OWNER'], metric: '68 companies', rows: [['Northstar Labs', 'Technology', '12', '3 · $64,000', 'Maya Chen'], ['Forma Studio', 'Design', '8', '2 · $32,500', 'Jordan Lee'], ['Greenway Co.', 'Sustainability', '6', '1 · $12,800', 'Alex Morgan'], ['Kinfield Group', 'Healthcare', '9', '2 · $28,200', 'Maya Chen']] },
  vendors: { title: 'Vendors', label: 'Manage your vendors and suppliers efficiently.', columns: ['VENDOR', 'CATEGORY', 'CONTACT PERSON', 'EMAIL', 'STATUS', 'RATING'], metric: 'Vendor directory', rows: [] },
  'billing-invoicing': { title: 'Billing & Invoicing', label: 'Create invoices, track payments, and keep customer balances in sync.', columns: [], metric: 'Financial workspace', rows: [] },
  deals: { title: 'Deals', label: 'Track opportunities and keep your pipeline moving forward.', columns: ['DEAL', 'COMPANY', 'STAGE', 'VALUE', 'CLOSE DATE'], metric: '48 open deals', rows: [['Enterprise plan', 'Northstar Labs', 'Proposal', '$24,000', 'Nov 14'], ['Annual subscription', 'Forma Studio', 'Negotiation', '$18,500', 'Nov 08'], ['Team workspace', 'Greenway Co.', 'Qualified', '$12,800', 'Nov 21'], ['CRM migration', 'Kinfield Group', 'Discovery', '$9,200', 'Dec 02']] },
  activities: { title: 'Activities', label: 'Calls, meetings, and follow-ups to keep every deal on track.', columns: ['ACTIVITY', 'RELATED TO', 'TYPE', 'DUE', 'STATUS'], metric: '5 due today', rows: [['Follow up with Olivia', 'Northstar Labs', 'Call', 'Today · 10:30 AM', 'Open'], ['Send proposal', 'Northstar Labs', 'Email', 'Today · 1:00 PM', 'Open'], ['Review Q4 pipeline', 'Workspace', 'Task', 'Tomorrow · 9:00 AM', 'In progress'], ['Product walkthrough', 'Forma Studio', 'Meeting', 'Oct 30 · 2:00 PM', 'Scheduled']] },
  automation: { title: 'Automation', label: 'Give your team more time for the conversations that matter.', columns: ['WORKFLOW', 'TRIGGER', 'LAST RUN', 'COMPLETED', 'STATUS'], metric: '3 active workflows', rows: [['New lead follow-up', 'Lead created', '12 min ago', '128', 'Active'], ['Deal stage alert', 'Stage changed', '1 hour ago', '42', 'Active'], ['Weekly pipeline digest', 'Every Monday', 'Yesterday', '16', 'Active'], ['Inactive contact reminder', 'No activity · 30d', 'Oct 25', '9', 'Paused']] },
  email: { title: 'Email', label: 'Compose contact emails and review outbox delivery status.', columns: ['RECIPIENT', 'SUBJECT', 'STATUS'], metric: '0 saved emails', rows: [] },
  reports: { title: 'Reports', label: 'A clear view of team performance and business momentum.', columns: ['REPORT', 'OWNER', 'LAST UPDATED', 'SCHEDULE', ''], metric: '4 reports ready', rows: [['Pipeline overview', 'Maya Chen', 'Today · 9:12 AM', 'Weekly', 'Open'], ['Lead conversion', 'Jordan Lee', 'Yesterday', 'Monthly', 'Open'], ['Team activity', 'Alex Morgan', 'Oct 25', 'Weekly', 'Open'], ['Revenue forecast', 'Maya Chen', 'Oct 24', 'Monthly', 'Open']] },
  'audit-logs': { title: 'Audit Logs', label: 'Review changes made across this workspace.', columns: ['ACTOR', 'ACTION', 'RECORD', 'RECORD ID', 'WHEN'], metric: 'Workspace history', rows: [] },
  settings: { title: 'Settings', label: 'Manage workspace identity and regional preferences.', columns: ['SETTING', 'VALUE'], metric: 'Workspace preferences', rows: [] },
  team: { title: 'Team', label: 'Manage organization members, invitations, and access roles.', columns: [], metric: 'Workspace access', rows: [] },
};

export default function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [dealView, setDealView] = useState<'board' | 'table' | 'radar'>('board');
  const [moduleRows, setModuleRows] = useState<string[][]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [enabledModules, setEnabledModules] = useState<string[] | null>(null);
  const [moduleAccessError, setModuleAccessError] = useState('');
  const { module: moduleName } = use(params);
  const router = useRouter();
  const data = records[moduleName] || records.leads;
  const singular = { Leads: 'lead', Contacts: 'contact', Companies: 'company', Vendors: 'vendor', Deals: 'deal', Activities: 'activity', Automation: 'workflow', Email: 'email', Reports: 'report', 'Audit Logs': 'event', Settings: 'setting', Team: 'member' }[data.title] || 'record';
  useEffect(() => {
    const savedPreference = window.localStorage.getItem('myr.sidebar.collapsed');
    const collapsed = savedPreference === null
      ? window.matchMedia('(min-width: 601px) and (max-width: 850px)').matches
      : savedPreference === 'true';
    setSidebarCollapsed(collapsed);
  }, []);
  useEffect(() => {
    const saved = sessionStorage.getItem(`myr.preview.${moduleName}`);
    setModuleRows(saved ? JSON.parse(saved) as string[][] : data.rows);
  }, [data, moduleName]);
  useEffect(() => {
    let controller = new AbortController();
    const loadModules = () => {
      controller.abort();
      const requestController = new AbortController();
      controller = requestController;
      setEnabledModules(null);
      setModuleAccessError('');
      void fetchEnabledModules(requestController.signal)
        .then(setEnabledModules)
        .catch((error: unknown) => {
          if (!requestController.signal.aborted) {
            setEnabledModules([]);
            setModuleAccessError(error instanceof Error ? error.message : 'Could not load workspace module access.');
          }
        });
    };
    loadModules();
    window.addEventListener('myr:organization-changed', loadModules);
    return () => {
      controller.abort();
      window.removeEventListener('myr:organization-changed', loadModules);
    };
  }, []);
  useEffect(() => {
    if (enabledModules === null || moduleAccessError || enabledModules.includes(moduleName)) return;
    const firstAvailable = navigation.find(([, href]) => enabledModules.includes(href.slice(1)));
    router.replace(firstAvailable?.[1] ?? '/');
  }, [enabledModules, moduleAccessError, moduleName, router]);
  const rows = useMemo(() => moduleRows.filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase())), [moduleRows, query]);
  const moduleChart = useMemo(() => {
    const config = moduleCharts[data.title];
    if (!config) return null;
    const counts = new Map<string, number>();
    rows.forEach((row) => {
      const value = row[config.index]?.trim();
      if (value && value !== '—') counts.set(value, (counts.get(value) ?? 0) + 1);
    });
    const items: DistributionDatum[] = [...counts.entries()].map(([label, value], index) => ({ label, value, color: distributionColors[index % distributionColors.length] }));
    return { title: config.dimension, kind: config.kind, items };
  }, [data.title, rows]);
  const radarStages = useMemo(() => dealStages.map((stage) => ({
    label: stage.name,
    value: rows.filter((row) => row[2] === stage.name).reduce((total, row) => total + (Number(row[3]?.replace(/[^0-9.]/g, '')) || 0), 0),
  })), [rows]);

  function addRecord(row: string[]) {
    const nextRows = [row, ...moduleRows];
    setModuleRows(nextRows);
    sessionStorage.setItem(`myr.preview.${moduleName}`, JSON.stringify(nextRows));
    setShowCreate(false);
    setNotice(`${row[0]} was added to this browser preview.`);
  }

  function moveDeal(dealName: string, stage: string) {
    const nextRows = moduleRows.map((row) => row[0] === dealName ? row.map((cell, index) => index === 2 ? stage : cell) : row);
    setModuleRows(nextRows);
    sessionStorage.setItem(`myr.preview.${moduleName}`, JSON.stringify(nextRows));
    setNotice(`${dealName} moved to ${stage} in this browser preview.`);
  }

  function formatStageTotal(stageRows: string[][]) {
    const value = stageRows.reduce((total, row) => total + (Number(row[3]?.replace(/[^0-9.]/g, '')) || 0), 0);
    return `$${value.toLocaleString('en-US')}`;
  }

  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem('myr.sidebar.collapsed', String(next));
      return next;
    });
  }

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Sign out failed (HTTP ${response.status}). Please try again.`);
      sessionStorage.removeItem('myr.session');
      sessionStorage.removeItem('myr.user');
      sessionStorage.removeItem('myr.organization');
      window.location.assign('/sign-in');
    } catch (caught) {
      setSignOutError(caught instanceof Error ? caught.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <main className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand-row">
          <Link className="brand" href="/" aria-label="Myr CRM home"><span className="brand-mark">m</span><span>myr<span className="brand-light">crm</span></span></Link>
          <button className="sidebar-toggle" type="button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar}><span aria-hidden="true">{sidebarCollapsed ? '›' : '‹'}</span></button>
        </div>
        <WorkspaceSwitcher />
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.filter(([label, href]) => label === 'Overview' || enabledModules?.includes(href.slice(1))).map(([label, href]) => <Link key={label} href={href} className={`nav-item${label === data.title ? ' active' : ''}`} aria-current={label === data.title ? 'page' : undefined}><span className="module-nav-icon" aria-hidden="true">{label === 'Overview' ? '◫' : label === 'Leads' || label === 'Team' ? '♙' : label === 'Contacts' ? '◎' : label === 'Companies' ? '▦' : label === 'Deals' ? '◇' : label === 'Vendors' ? '♧' : label === 'Billing & Invoicing' ? '$' : label === 'Activities' ? '◷' : label === 'Automation' ? '✳' : label === 'Email' ? '✉' : '⌁'}</span><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><strong>Need a hand?</strong><p>Visit our help center to get started.</p><HelpPopover /></div><ProfileMenu /></div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <MobileNavigation active={data.title} enabledModules={enabledModules ?? []} />
          <div className="breadcrumbs"><span>Workspace</span><span aria-hidden="true">›</span><strong>{data.title}</strong></div>
          <div className="topbar-actions">
            <GlobalSearch />
            <NotificationPopover />
            <span className="preview-chip"><span />{['Leads', 'Contacts', 'Companies', 'Vendors', 'Billing & Invoicing', 'Deals', 'Email', 'Reports', 'Audit Logs', 'Settings', 'Team'].includes(data.title) ? 'Live workspace' : 'Preview data'}</span>
            <button className="header-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
            {signOutError && <span className="header-signout-error" role="alert">{signOutError}</span>}
          </div>
        </header>
        {moduleAccessError && <p className="module-permissions-error" role="alert">{moduleAccessError}</p>}
        <div className="content module-content">
          {data.title === 'Billing & Invoicing' ? <BillingManager /> : data.title === 'Automation' ? <AutomationsManager /> : data.title === 'Email' ? <EmailsManager /> : data.title === 'Reports' ? <ReportsManager /> : data.title === 'Audit Logs' ? <AuditLogsManager /> : data.title === 'Settings' ? <SettingsManager /> : data.title === 'Team' ? <MembersManager /> : data.title === 'Leads' ? <LeadsManager /> : data.title === 'Contacts' ? <ContactsManager /> : data.title === 'Companies' ? <CompaniesManager /> : data.title === 'Vendors' ? <VendorsManager /> : data.title === 'Deals' ? <DealsManager /> : <>
          <section className="welcome-row module-welcome"><div><p className="date-label">{data.title === 'Activities' ? 'WORKSPACE / ACTIVITY TIMELINE' : `WORKSPACE / ${data.title.toUpperCase()}`}</p><h1>{data.title === 'Activities' ? 'Activity timeline' : data.title}</h1><p className="welcome-copy">{data.title === 'Activities' ? 'Keep calls, meetings, and follow-ups organized across your workspace.' : data.label}</p></div><button className="button button-primary" type="button" onClick={() => setShowCreate(true)}><span aria-hidden="true">＋</span> Add {singular}</button></section>
          {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}
          <div className="demo-notice"><span className="notice-dot" /> This is a UI preview with sample data. Records are not connected to a database yet.</div>
          <section className="metric-grid module-metrics" aria-label={`${data.title} summary`}><article className="metric-card"><div className="metric-top"><span>Workspace total</span><span className="metric-icon mint">↗</span></div><div className="metric-value">{data.metric.split(' ')[0]}</div><div className="metric-foot"><span>{data.metric.replace(data.metric.split(' ')[0], '').trim()}</span><span>· Sample data</span></div></article><article className="metric-card"><div className="metric-top"><span>Last updated</span><span className="metric-icon lavender">◷</span></div><div className="metric-value">Today</div><div className="metric-foot"><span>Preview workspace</span></div></article><article className="metric-card module-summary-card"><div className="metric-top"><span>Showing</span><span className="metric-icon peach">⌕</span></div><div className="metric-value">{rows.length} <small>of {data.metric.split(' ')[0]}</small></div><div className="metric-foot"><span>{query ? 'Matching your search' : 'Across this workspace'}</span></div></article></section>
          {moduleChart && <section className="panel module-chart-panel">{moduleChart.kind === 'radial' ? <RadialBarChart title={moduleChart.title} items={moduleChart.items} /> : <NightingaleChart title={moduleChart.title} items={moduleChart.items} />}</section>}
          <section className="panel module-directory"><div className="panel-heading module-directory-heading"><div><h2>{data.title} {data.title === 'Deals' && dealView === 'board' ? 'pipeline' : data.title === 'Deals' && dealView === 'radar' ? 'value radar' : 'directory'}</h2><p>{data.metric} · Sample workspace records</p></div><div className="module-heading-actions">{data.title === 'Deals' && <div className="view-toggle" aria-label="Choose deals view"><button type="button" className={dealView === 'board' ? 'active' : ''} aria-pressed={dealView === 'board'} onClick={() => setDealView('board')}>Board</button><button type="button" className={dealView === 'radar' ? 'active' : ''} aria-pressed={dealView === 'radar'} onClick={() => setDealView('radar')}>Radar</button><button type="button" className={dealView === 'table' ? 'active' : ''} aria-pressed={dealView === 'table'} onClick={() => setDealView('table')}>Table</button></div>}<label className="module-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${data.title.toLowerCase()}...`} aria-label={`Search ${data.title}`} />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label></div></div>
            {data.title === 'Deals' && dealView === 'radar' ? <RadarStageChart items={radarStages} /> : data.title === 'Deals' && dealView === 'board' ? <div className="deal-board-scroll"><div className="deal-board">{dealStages.map((stage) => { const stageRows = rows.filter((row) => row[2] === stage.name); return <section className={`deal-board-column deal-tone-${stage.tone}`} key={stage.name}><header><span className="deal-stage-indicator" /><div><strong>{stage.name}</strong><small>{stageRows.length} {stageRows.length === 1 ? 'deal' : 'deals'}</small></div><span className="deal-stage-total">{formatStageTotal(stageRows)}</span></header><div className="deal-board-cards">{stageRows.map((row, index) => <article className="deal-board-card" key={`${row[0]}-${index}`}><span className="deal-card-company">{row[1]}</span><strong>{row[0]}</strong><div className="deal-board-card-foot"><b>{row[3]}</b><span>Close {row[4]}</span></div><label className="deal-move-control">Move to<select value={row[2]} onChange={(event) => moveDeal(row[0], event.target.value)} aria-label={`Move ${row[0]} to stage`}><option value={row[2]}>{row[2]}</option>{dealStages.filter((option) => option.name !== row[2]).map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}</select></label></article>)}</div>{!stageRows.length && <p className="deal-board-empty">No deals in this stage</p>}</section>; })}</div></div> : <div className="table-scroll"><table><thead><tr>{data.columns.map((column, index) => <th key={`${column}-${index}`}>{column || <span className="sr-only">Actions</span>}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className={cellIndex === 0 ? 'module-primary-cell' : ''}>{cellIndex === 0 && <span className="module-record-mark">{cell.split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>}{cell}</td>)}</tr>)}{rows.length === 0 && <tr><td className="module-empty" colSpan={data.columns.length}>No {data.title.toLowerCase()} match “{query}”. Try another search.</td></tr>}</tbody></table></div>}
            <div className="module-table-footer"><span>Showing {rows.length} of {data.metric.split(' ')[0]} {data.title.toLowerCase()}</span><span>Sample data · Not connected to a database</span></div>
          </section>
          <footer className="page-footer"><span>MYR CRM <i /> Workspace {data.title.toLowerCase()}</span><span>Preview build · Sample data</span></footer>
          </>}
        </div>
        {showCreate && <CreateRecordDialog title={singular} columns={data.columns} onClose={() => setShowCreate(false)} onCreate={addRecord} />}
      </section>
    </main>
  );
}
