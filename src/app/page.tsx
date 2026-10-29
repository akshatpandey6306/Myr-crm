import NotificationPopover from './components/NotificationPopover';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import ProfileMenu from './components/ProfileMenu';
import ActionMenu from './components/ActionMenu';
import GlobalSearch from './components/GlobalSearch';
import HelpPopover from './components/HelpPopover';
import PipelineDistributionChart from './components/PipelineDistributionChart';
import MobileNavigation from './components/MobileNavigation';

const navigation = [
  { label: "Overview", icon: "grid", active: true },
  { label: "Leads", icon: "users", count: "24" },
  { label: "Contacts", icon: "contact" },
  { label: "Companies", icon: "building" },
  { label: "Deals", icon: "briefcase" },
  { label: "Activities", icon: "calendar", count: "5" },
  { label: "Automation", icon: "sparkles" },
  { label: "Reports", icon: "chart" },
];

const metrics = [
  {
    label: "Total leads",
    value: "1,284",
    change: "+12.8%",
    note: "vs. last month",
    icon: "users",
    tone: "mint",
  },
  {
    label: "Open deals",
    value: "48",
    change: "+8.2%",
    note: "vs. last month",
    icon: "briefcase",
    tone: "peach",
  },
  {
    label: "Pipeline value",
    value: "$284,500",
    change: "+14.6%",
    note: "vs. last month",
    icon: "coins",
    tone: "lavender",
  },
  {
    label: "Won this month",
    value: "12",
    change: "+4.1%",
    note: "vs. last month",
    icon: "trophy",
    tone: "yellow",
  },
];

const deals = [
  {
    company: "Northstar Labs",
    initials: "NL",
    color: "blue",
    title: "Enterprise plan",
    owner: "Maya Chen",
    stage: "Proposal",
    amount: "$24,000",
    probability: "75%",
  },
  {
    company: "Forma Studio",
    initials: "FS",
    color: "purple",
    title: "Annual subscription",
    owner: "Jordan Lee",
    stage: "Negotiation",
    amount: "$18,500",
    probability: "90%",
  },
  {
    company: "Greenway Co.",
    initials: "GW",
    color: "green",
    title: "Team workspace",
    owner: "Alex Morgan",
    stage: "Qualified",
    amount: "$12,800",
    probability: "40%",
  },
  {
    company: "Kinfield Group",
    initials: "KG",
    color: "orange",
    title: "CRM migration",
    owner: "Maya Chen",
    stage: "Discovery",
    amount: "$9,200",
    probability: "20%",
  },
];

const activities = [
  {
    initials: "MC",
    name: "Maya Chen",
    action: "moved a deal to",
    target: "Proposal",
    time: "12 min ago",
    color: "blue",
  },
  {
    initials: "JL",
    name: "Jordan Lee",
    action: "added a new lead",
    target: "Olivia Rhye",
    time: "48 min ago",
    color: "purple",
  },
  {
    initials: "AM",
    name: "Alex Morgan",
    action: "completed a call with",
    target: "Greenway Co.",
    time: "2 hours ago",
    color: "green",
  },
];

const tasks = [
  { title: "Follow up with Olivia Rhye", detail: "Today · 10:30 AM", tag: "Call" },
  { title: "Send proposal to Northstar Labs", detail: "Today · 1:00 PM", tag: "Email" },
  { title: "Review Q4 pipeline", detail: "Tomorrow · 9:00 AM", tag: "Task" },
];

const pipeline = [
  { name: "Discovery", value: 42500, color: "#3678D4" },
  { name: "Qualified", value: 68200, color: "#8254C7" },
  { name: "Proposal", value: 91800, color: "#E56F4A" },
  { name: "Negotiation", value: 54600, color: "#24936F" },
];

const pipelineTotal = pipeline.reduce((total, stage) => total + stage.value, 0);
const largestPipelineStage = pipeline.reduce((largest, stage) => stage.value > largest.value ? stage : largest, pipeline[0]);
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
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Myr CRM home">
          <span className="brand-mark">m</span>
          <span>myr<span className="brand-light">crm</span></span>
        </a>

        <WorkspaceSwitcher />

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <a
              className={`nav-item${item.active ? " active" : ""}`}
              href={item.active ? "/" : `/${item.label.toLowerCase()}`}
              key={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.count && <span className="nav-count">{item.count}</span>}
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
          <MobileNavigation active="Overview" />
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron" />
            <strong>Overview</strong>
          </div>
          <div className="topbar-actions">
            <GlobalSearch />
            <NotificationPopover />
            <div className="preview-chip"><span /> Preview data</div>
          </div>
        </header>

        <div className="content">
          <section className="welcome-row">
            <div>
              <p className="date-label">MONDAY, OCTOBER 27, 2026</p>
              <h1>Good morning, Maya <span>✦</span></h1>
              <p className="welcome-copy">Here&apos;s what&apos;s happening with your workspace today.</p>
            </div>
            <div className="welcome-actions">
              <a className="button button-secondary" href="/reports">
                <span className="button-icon">⌑</span> Last 30 days <span className="button-caret">↗</span>
              </a>
              <a className="button button-primary" href="/leads">
                <Icon name="plus" /> Add new lead
              </a>
            </div>
          </section>

          <div className="demo-notice">
            <span className="notice-dot" />
            This is a UI preview with sample data. CRM records and metrics are not connected to a database yet.
          </div>

          <section className="metric-grid" aria-label="CRM summary">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-top">
                  <span>{metric.label}</span>
                  <span className={`metric-icon ${metric.tone}`}><Icon name={metric.icon} /></span>
                </div>
                <div className="metric-value">{metric.value}</div>
                <div className="metric-foot">
                  <span className="positive-change">↗ {metric.change}</span>
                  <span>{metric.note}</span>
                </div>
              </article>
            ))}
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
                <span className="positive-change">↗ 12.4%</span>
                <span className="muted-copy">total pipeline value</span>
              </div>
              <PipelineDistributionChart items={pipeline.map((stage) => ({ label: stage.name, value: stage.value, color: stage.color }))} />
              <div className="pipeline-footer">
                <span><i className="legend-dot" /> Largest stage <b>{largestPipelineStage.name}</b> · {((largestPipelineStage.value / pipelineTotal) * 100).toFixed(1)}% of total</span>
                <a href="/deals">View pipeline <Icon name="arrow" /></a>
              </div>
            </article>

            <article className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>What your team has been up to</p>
                </div>
                <ActionMenu label="More activity options" destination="/activities" copyText="Recent activity" />
              </div>
              <div className="activity-list">
                {activities.map((activity) => (
                  <div className="activity-item" key={`${activity.name}-${activity.time}`}>
                    <span className={`avatar avatar-${activity.color}`}>{activity.initials}</span>
                    <div className="activity-copy">
                      <p><strong>{activity.name}</strong> {activity.action} <b>{activity.target}</b></p>
                      <span>{activity.time}</span>
                    </div>
                  </div>
                ))}
              </div>
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
                    <th>PROBABILITY</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((deal) => (
                    <tr key={deal.company}>
                      <td><span className={`company-avatar company-${deal.color}`}>{deal.initials}</span><strong>{deal.company}</strong></td>
                      <td className="deal-name">{deal.title}</td>
                      <td><span className="avatar avatar-owner">{deal.owner.split(" ").map((part) => part[0]).join("")}</span>{deal.owner}</td>
                      <td><span className={`stage-pill stage-${deal.stage.toLowerCase()}`}>{deal.stage}</span></td>
                      <td className="amount-cell">{deal.amount}</td>
                      <td><span className="probability"><i style={{ width: deal.probability }} />{deal.probability}</span></td>
                      <td><ActionMenu label={`More options for ${deal.company}`} destination="/deals" copyText={deal.company} buttonClass="row-more" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel tasks-panel" id="activities">
            <div className="panel-heading deals-heading">
              <div>
                <h2>Upcoming tasks</h2>
                <p>You have <strong>3 things</strong> on your plate</p>
              </div>
              <a className="text-link" href="/activities">View calendar <Icon name="arrow" /></a>
            </div>
            <div className="task-list">
              {tasks.map((task) => (
                <div className="task-item" key={task.title}>
                  <span className="task-check" aria-hidden="true" />
                  <div className="task-copy"><strong>{task.title}</strong><span>{task.detail}</span></div>
                  <span className={`task-tag task-${task.tag.toLowerCase()}`}>{task.tag}</span>
                  <ActionMenu label={`More options for ${task.title}`} destination="/activities" copyText={task.title} buttonClass="row-more" />
                </div>
              ))}
            </div>
          </section>

          <footer className="page-footer">
            <span>MYR CRM <i /> Workspace overview</span>
            <span>Preview build · Sample data</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
