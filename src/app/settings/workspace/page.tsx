import MembersManager from '../../features/team/MembersManager';

export default function WorkspaceControlPage() {
  return (
    <main className="settings-route-content">
      <p className="welcome-copy">Choose which plan-enabled modules each employee can access. The employee join code is visible to workspace administrators only.</p>
      <MembersManager />
    </main>
  );
}
