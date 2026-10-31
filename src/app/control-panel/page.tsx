'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useEffect, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Organization = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  memberCount: number;
  createdAt: string;
  owner: { name: string; email: string } | null;
  subscription: {
    planCode: string | null;
    status: 'pending' | 'trial' | 'active' | 'expired' | 'cancelled';
    startsAt: string | null;
    endsAt: string | null;
    provider: string | null;
  };
};
type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};



type WorkspaceFilter = 'all' | 'needs-attention' | 'active';

const subscriptionPlans = [
  { code: 'starter', name: 'Starter' },
  { code: 'growth', name: 'Growth' },
  { code: 'business', name: 'Business' },
] as const;

function isOrganization(value: unknown): value is Organization {
  if (typeof value !== 'object' || value === null) return false;
  const organization = value as Record<string, unknown>;
  return typeof organization.id === 'string' &&
    typeof organization.name === 'string' &&
    (organization.status === 'active' || organization.status === 'suspended') &&
    Number.isInteger(organization.memberCount) &&
    typeof organization.createdAt === 'string' &&
    (organization.owner === null || (
      typeof organization.owner === 'object' &&
      organization.owner !== null &&
      typeof (organization.owner as Record<string, unknown>).name === 'string' &&
      typeof (organization.owner as Record<string, unknown>).email === 'string'
    )) &&
    typeof organization.subscription === 'object' &&
    organization.subscription !== null &&
    ['pending', 'trial', 'active', 'expired', 'cancelled'].includes((organization.subscription as Record<string, unknown>).status as string);
}

export default function ControlPanelPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrganizationId, setBusyOrganizationId] = useState('');
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WorkspaceFilter>('all');
  const [signingOut, setSigningOut] = useState(false);
  const [onboarding, setOnboarding] = useState({ organizationName: '', ownerName: '', ownerEmail: '', ownerPassword: '', planCode: 'starter' });
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; action: string; targetType: string; targetId: string | null; actorUserId: string | null; createdAt: string }>>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [onboardingMessage, setOnboardingMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, WorkspaceMember[] | undefined>>({});
  const [loadingMembers, setLoadingMembers] = useState<Record<string, boolean>>({});
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});

  const activeSubscriptions = organizations.filter(({ subscription }) =>
    subscription.status === 'active' || subscription.status === 'trial').length;
  const attentionWorkspaces = organizations.filter(({ status, subscription }) =>
    status === 'suspended' || ['pending', 'expired', 'cancelled'].includes(subscription.status)).length;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOrganizations = organizations.filter((organization) => {
    const matchesSearch = !normalizedSearch || [
      organization.name,
      organization.owner?.name,
      organization.owner?.email,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    const matchesFilter = filter === 'all' ||
      (filter === 'active'
        ? organization.status === 'active' && ['active', 'trial'].includes(organization.subscription.status)
        : organization.status === 'suspended' || ['pending', 'expired', 'cancelled'].includes(organization.subscription.status));
    return matchesSearch && matchesFilter;
  });

  async function signOut() {
    setSigningOut(true);
    setError('');
    try {
      const response = await crmApiFetch('/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(`Sign out failed (HTTP ${response.status}). Please try again.`);
      sessionStorage.removeItem('myr.session');
      sessionStorage.removeItem('myr.user');
      sessionStorage.removeItem('myr.organization');
      window.location.assign('/sign-in');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  async function loadOrganizations(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/organizations', signal ? { signal } : {});
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('The control panel returned an invalid response.');
      }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        if (response.status === 401) {
          setError('Sign in with an internal administrator account to continue.');
        } else if (response.status === 403) {
          setError('This account does not have platform administrator access.');
        } else {
          setError(body?.message ?? 'Could not load customer workspaces.');
        }
        return;
      }
      if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data) || !(payload as { data: unknown[] }).data.every(isOrganization)) {
        throw new Error('The control panel returned an invalid organization list.');
      }
      setOrganizations((payload as { data: Organization[] }).data);
      setError('');
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') {
        setError(caught instanceof Error ? caught.message : 'Could not load customer workspaces.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadOrganizations(controller.signal);
    return () => controller.abort();
  }, []);
  async function refreshOrganizations() {
    setRefreshing(true);
    setLoading(true);
    await loadOrganizations();
  }

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOnboardingBusy(true);
    setError('');
    setOnboardingMessage('');
    try {
      const response = await crmApiFetch('/control-panel/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: onboarding.organizationName,
          ownerName: onboarding.ownerName,
          ownerEmail: onboarding.ownerEmail,
          ownerPassword: onboarding.ownerPassword,
          planCode: onboarding.planCode === 'pending' ? undefined : onboarding.planCode,
        }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not create workspace.');
      }
      const data = typeof payload === 'object' && payload !== null && 'data' in payload ? (payload as { data?: { name?: string; owner?: { email?: string } } }).data : undefined;
      setOnboardingMessage(`Created ${data?.name ?? 'workspace'} for ${data?.owner?.email ?? onboarding.ownerEmail}.`);
      setOnboarding({ organizationName: '', ownerName: '', ownerEmail: '', ownerPassword: '', planCode: 'starter' });
      await loadOrganizations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create workspace.');
    } finally {
      setOnboardingBusy(false);
    }
  }
  async function loadAuditLogs() {
    setLoadingAuditLogs(true);
    try {
      const response = await crmApiFetch('/control-panel/audit-logs?limit=50');
      let payload: unknown;
      try { payload = await response.json(); } catch { return; }
      if (response.ok && typeof payload === 'object' && payload !== null && Array.isArray((payload as { data?: unknown }).data)) {
        setAuditLogs((payload as { data: Array<{ id: string; action: string; targetType: string; targetId: string | null; actorUserId: string | null; createdAt: string }> }).data);
      }
    } finally {
      setLoadingAuditLogs(false);
    }
  }



  async function toggleMembers(organization: Organization) {
    if (expandedMembers[organization.id]) {
      setExpandedMembers((current) => ({ ...current, [organization.id]: undefined }));
      return;
    }
    setLoadingMembers((current) => ({ ...current, [organization.id]: true }));
    setMemberErrors((current) => ({ ...current, [organization.id]: '' }));
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/members`);
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not load workspace members.');
      }
      if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
        throw new Error('The control panel returned an invalid member list.');
      }
      setExpandedMembers((current) => ({ ...current, [organization.id]: (payload as { data: WorkspaceMember[] }).data }));
    } catch (caught) {
      setMemberErrors((current) => ({ ...current, [organization.id]: caught instanceof Error ? caught.message : 'Could not load workspace members.' }));
    } finally {
      setLoadingMembers((current) => ({ ...current, [organization.id]: false }));
    }
  }



  async function setOrganizationStatus(organization: Organization) {
    const status = organization.status === 'active' ? 'suspended' : 'active';
    if (status === 'suspended' && !window.confirm(`Suspend ${organization.name}? Its members will lose CRM access.`)) return;
    if (status === 'active' && !window.confirm(`Restore access for ${organization.name}?`)) return;
    setBusyOrganizationId(organization.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not update workspace access.');
      }
      setOrganizations((current) => current.map((item) => item.id === organization.id ? { ...item, status } : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update workspace access.');
    } finally {
      setBusyOrganizationId('');
    }
  }

  async function setSubscriptionStatus(organization: Organization, status: 'active' | 'expired' | 'cancelled') {
    const planCode = selectedPlans[organization.id] ?? organization.subscription.planCode ?? 'starter';
    if (status === 'expired' && !window.confirm(`Expire ${organization.name}'s subscription now?`)) return;
    if (status === 'cancelled' && !window.confirm(`Cancel ${organization.name}'s subscription?`)) return;
    setBusyOrganizationId(organization.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          ...(status === 'active' ? { planCode } : {}),
        }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not update subscription.');
      }
      const subscription = typeof payload === 'object' && payload !== null && 'data' in payload ? (payload as { data?: unknown }).data : undefined;
      if (typeof subscription !== 'object' || subscription === null || typeof (subscription as { status?: unknown }).status !== 'string') {
        throw new Error('The control panel returned an invalid subscription update.');
      }
      setOrganizations((current) => current.map((item) => item.id === organization.id
        ? { ...item, subscription: { planCode: (subscription as { planCode?: string | null }).planCode ?? null, status: (subscription as { status: string }).status as Organization['subscription']['status'], startsAt: (subscription as { startsAt?: string | null }).startsAt ?? null, endsAt: (subscription as { endsAt?: string | null }).endsAt ?? null, provider: (subscription as { provider?: string | null }).provider ?? null } }
        : item));
      setSelectedPlans((plans) => ({ ...plans, [organization.id]: planCode }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update subscription.');
    } finally {
      setBusyOrganizationId('');
    }
  }

  return (
    <main className="control-panel-page">
      <header className="control-panel-header">
        <div className="brand" aria-label="Myr CRM platform administration">
          <span className="brand-mark">m</span>
          <span>myr<span className="brand-light">crm</span></span>
        </div>
        <button suppressHydrationWarning className="control-panel-signout" type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </header>
      <div className="control-panel-content">
        <div className="control-panel-title-row">
          <div>
            <p className="date-label">INTERNAL ADMINISTRATION</p>
            <h1>Workspace overview</h1>
            <p className="control-panel-intro">Manage plans and access for customer workspaces. Your platform-admin account does not need a customer plan.</p>
          </div>
          <div className="control-panel-title-actions">
            <button suppressHydrationWarning className="control-panel-action" type="button" disabled={refreshing || loading} onClick={() => void refreshOrganizations()}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <span className="control-panel-live"><i /> Admin console</span>
          </div>
        </div>

        {error && (
          <div className="control-panel-error" role="alert">
            {error}
            {error.startsWith('Sign in') && <> <Link href="/sign-in">Sign in</Link></>}
          </div>
        )}

        <section className="control-panel-metrics" aria-label="Workspace summary">
          <article className="control-panel-metric">
            <span className="control-panel-metric-icon violet">▦</span>
            <div><p>Total workspaces</p><strong>{loading ? '—' : organizations.length}</strong></div>
          </article>
          <article className="control-panel-metric">
            <span className="control-panel-metric-icon green">✓</span>
            <div><p>Active subscriptions</p><strong>{loading ? '—' : activeSubscriptions}</strong></div>
          </article>
          <article className="control-panel-metric">
            <span className="control-panel-metric-icon amber">!</span>
            <div><p>Need attention</p><strong>{loading ? '—' : attentionWorkspaces}</strong></div>
          </article>
        </section>

        <section className="panel control-panel-onboarding" aria-label="Onboard customer workspace">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Onboard workspace</h2>
              <p>Create a customer workspace, owner account, and optional initial plan.</p>
            </div>
          </div>
          {onboardingMessage && <p className="control-panel-empty" role="status">{onboardingMessage}</p>}
          <form className="control-panel-onboarding-form" onSubmit={(event) => void createWorkspace(event)}>
            <label>Workspace name<input value={onboarding.organizationName} required onChange={(event) => setOnboarding((current) => ({ ...current, organizationName: event.target.value }))} placeholder="Acme Corp" /></label>
            <label>Owner name<input value={onboarding.ownerName} required onChange={(event) => setOnboarding((current) => ({ ...current, ownerName: event.target.value }))} placeholder="Jane Owner" /></label>
            <label>Owner email<input type="email" value={onboarding.ownerEmail} required onChange={(event) => setOnboarding((current) => ({ ...current, ownerEmail: event.target.value }))} placeholder="jane@example.com" /></label>
            <label>Owner password<input type="password" value={onboarding.ownerPassword} required minLength={8} onChange={(event) => setOnboarding((current) => ({ ...current, ownerPassword: event.target.value }))} placeholder="At least 8 characters" /></label>
            <label>Initial plan
              <select value={onboarding.planCode} onChange={(event) => setOnboarding((current) => ({ ...current, planCode: event.target.value }))}>
                <option value="pending">No plan (pending)</option>
                {subscriptionPlans.map(({ code, name }) => <option key={code} value={code}>{name} · 30 days</option>)}
              </select>
            </label>
            <button suppressHydrationWarning className="control-panel-action primary" type="submit" disabled={onboardingBusy}>{onboardingBusy ? 'Creating…' : 'Create workspace'}</button>
          </form>
        </section>

        <section className="panel control-panel-table" aria-label="Customer workspaces">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Workspaces</h2>
              <p>{visibleOrganizations.length} of {organizations.length} customer {organizations.length === 1 ? 'workspace' : 'workspaces'}</p>
            </div>
            <label className="control-panel-search">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search workspaces and owners</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workspaces or owners" />
            </label>
          </div>
          <div className="control-panel-filters" aria-label="Filter workspaces">
            {([
              ['all', 'All workspaces'],
              ['needs-attention', 'Needs attention'],
              ['active', 'Active'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={`control-panel-filter${filter === value ? ' selected' : ''}`}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
                {value === 'needs-attention' && <span>{loading ? '—' : attentionWorkspaces}</span>}
              </button>
            ))}
          </div>
          {loading ? <p className="control-panel-empty">Loading customer workspaces…</p> : organizations.length === 0 && !error ? (
            <p className="control-panel-empty">No customer workspaces yet.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>WORKSPACE</th>
                    <th>OWNER</th>
                    <th>MEMBERS</th>
                    <th>CREATED</th>
                    <th>ACCESS</th>
                    <th>CUSTOMER PLAN</th>
                    <th>ENDS</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrganizations.map((organization) => {
                    const hasActiveSubscription = organization.subscription.status === 'active' || organization.subscription.status === 'trial';
                    const selectedPlan = selectedPlans[organization.id] ?? organization.subscription.planCode ?? 'starter';
                    const currentPlanName = subscriptionPlans.find(({ code }) => code === selectedPlan)?.name ?? 'Starter';
                    return (
                    <Fragment key={organization.id}>
                    <tr>
                      <td><div className="control-panel-workspace"><span className="control-panel-workspace-avatar">{organization.name.slice(0, 1).toUpperCase()}</span><strong>{organization.name}</strong></div></td>
                      <td>{organization.owner ? <div className="control-panel-owner"><strong>{organization.owner.name}</strong><span>{organization.owner.email}</span></div> : '—'}</td>
                      <td>
                        <button suppressHydrationWarning className="control-panel-member-count control-panel-member-toggle" type="button" onClick={() => void toggleMembers(organization)} aria-expanded={Boolean(expandedMembers[organization.id])}>
                          {organization.memberCount} {expandedMembers[organization.id] ? '▲' : '▼'}
                        </button>
                      </td>
                      <td>{new Date(organization.createdAt).toLocaleDateString()}</td>
                      <td><span className={`control-panel-status ${organization.status}`}>{organization.status}</span></td>
                      <td>
                        <div className="control-panel-plan">
                          <strong>{organization.subscription.planCode ?? 'No plan'}</strong>
                          <span className={`control-panel-status ${organization.subscription.status}`}>{organization.subscription.status}</span>
                        </div>
                      </td>
                      <td>{organization.subscription.endsAt ? new Date(organization.subscription.endsAt).toLocaleDateString() : '—'}</td>
                      <td><div className="control-panel-actions-cell">
                          <label className="sr-only" htmlFor={`plan-${organization.id}`}>Plan for {organization.name}</label>
                          <select id={`plan-${organization.id}`} value={selectedPlan} disabled={busyOrganizationId === organization.id} onChange={(event) => setSelectedPlans((plans) => ({ ...plans, [organization.id]: event.target.value }))}>
                            {subscriptionPlans.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
                          </select>
                          <button suppressHydrationWarning className="control-panel-action primary" type="button" disabled={busyOrganizationId === organization.id} onClick={() => void setSubscriptionStatus(organization, 'active')}>
                            {busyOrganizationId === organization.id
                              ? 'Saving…'
                              : hasActiveSubscription
                                ? selectedPlan !== organization.subscription.planCode ? `Change to ${currentPlanName} · 30 days` : 'Extend 30 days'
                                : organization.subscription.status === 'expired'
                                  ? `Reactivate on ${currentPlanName} · 30 days`
                                  : `Activate ${currentPlanName} · 30 days`}
                          </button>
                          {hasActiveSubscription
                            ? <>
  <button suppressHydrationWarning className="control-panel-action danger" type="button" disabled={busyOrganizationId === organization.id} onClick={() => void setSubscriptionStatus(organization, 'expired')}>Expire now</button>
  <button suppressHydrationWarning className="control-panel-action danger" type="button" disabled={busyOrganizationId === organization.id} onClick={() => void setSubscriptionStatus(organization, 'cancelled')}>Cancel plan</button>
</>
                            : null}
                          <button suppressHydrationWarning className="control-panel-action" type="button" disabled={busyOrganizationId === organization.id} onClick={() => void setOrganizationStatus(organization)}>
                            {organization.status === 'active' ? 'Suspend workspace' : 'Restore workspace'}
                          </button>
                        </div></td>
                    </tr>
                     {expandedMembers[organization.id] !== undefined && (
                       <tr className="control-panel-members-row">
                         <td colSpan={8}>
                           {loadingMembers[organization.id] ? (
                             <p className="control-panel-empty">Loading members…</p>
                           ) : memberErrors[organization.id] ? (
                             <p className="control-panel-error" role="alert">{memberErrors[organization.id]}</p>
                           ) : expandedMembers[organization.id]?.length ? (
                             <table className="control-panel-members-table">
                               <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th></tr></thead>
                               <tbody>
                                 {expandedMembers[organization.id]?.map((member) => (
                                   <tr key={member.id}>
                                     <td>{member.name}</td>
                                     <td>{member.email}</td>
                                     <td><span className="control-panel-status active">{member.role}</span></td>
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           ) : (
                             <p className="control-panel-empty">No active members.</p>
                           )}
                         </td>
                       </tr>
                     )}

                     </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {visibleOrganizations.length === 0 && (
                <p className="control-panel-empty">No workspaces match these filters. Try a different search or filter.</p>
              )}
            </div>
          )}
        </section>
        <section className="panel control-panel-audit" aria-label="Audit log">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Audit log</h2>
              <p>Recent platform administrator actions.</p>
            </div>
            <button suppressHydrationWarning className="control-panel-action" type="button" disabled={loadingAuditLogs} onClick={() => void loadAuditLogs()}>
              {loadingAuditLogs ? 'Loading…' : 'Load audit log'}
            </button>
          </div>
          {auditLogs.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th>TIME</th><th>ACTION</th><th>TARGET</th><th>ACTOR</th></tr></thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>{log.action}</td>
                      <td>{log.targetType}{log.targetId ? ` · ${log.targetId}` : ''}</td>
                      <td>{log.actorUserId ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="control-panel-note">Select a plan, then activate or change it to grant 30 days of access. Suspended workspaces remain blocked until restored. Manual plan changes do not collect payment.</p>
      </div>
    </main>
  );
}
