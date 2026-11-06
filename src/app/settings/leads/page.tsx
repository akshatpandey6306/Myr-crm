import Link from 'next/link';

const leadSources = ['Website', 'Referral', 'LinkedIn', 'Other'];
const leadStatuses = ['New', 'Contacted', 'Qualified', 'Disqualified'];

export default function LeadSettingsPage() {
  return (
    <main className="settings-route-content">
      <p className="welcome-copy">Current lead options are defined by the CRM data model. Custom sources and statuses are not configurable yet.</p>
      <div className="settings-route-grid">
        <section className="settings-route-card">
          <h2>Lead sources</h2>
          <ul>{leadSources.map((source) => <li key={source}>{source}</li>)}</ul>
        </section>
        <section className="settings-route-card">
          <h2>Lead statuses</h2>
          <ul>{leadStatuses.map((status) => <li key={status}>{status}</li>)}</ul>
        </section>
      </div>
      <Link className="button button-secondary" href="/leads">Open Leads</Link>
    </main>
  );
}
