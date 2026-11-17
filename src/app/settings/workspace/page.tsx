import MembersManager from '../../features/team/MembersManager';

export default function WorkspaceControlPage() {
  return (
    <main className="settings-route-content">
      <p className="welcome-copy">Choose which plan-enabled modules each employee can access. Employee accounts sign in with their work email and password.</p>
      <MembersManager />
    </main>
  );
}
