import Link from 'next/link';

const roles = [
  ['Owner', 'Full workspace control, including ownership and billing.'],
  ['Admin', 'Manages members, workspace settings, and CRM records.'],
  ['Sales Manager', 'Manages sales records and team assignments.'],
  ['Sales Rep', 'Works with assigned sales records and activities.'],
  ['Read Only', 'Views workspace records without changing them.'],
];

export default function RolesSettingsPage() {
  return (
    <main className="settings-route-content">
      <p className="welcome-copy">Workspace roles are fixed by the current permission model. Owners and Admins can assign roles in Team.</p>
      <div className="settings-route-grid">
        {roles.map(([role, description]) => (
          <article className="settings-route-card" key={role}>
            <h2>{role}</h2>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <Link className="button button-secondary" href="/team">Manage team roles</Link>
    </main>
  );
}
