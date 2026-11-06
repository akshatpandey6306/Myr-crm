'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { useEffect, useRef, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';

type Organization = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  memberCount: number;
  pendingMemberRequestCount: number;
  dealCount: number;
  openPipelineValue: number;
  wonRevenue: number;
  currency: string;
  createdAt: string;
  enabledModules: string[];
  owner: { name: string; email: string } | null;
  subscription: {
    planCode: string | null;
    status: 'pending' | 'trial' | 'active' | 'expired' | 'cancelled';
    startsAt: string | null;
    endsAt: string | null;
    provider: string | null;
  };
};
type SubscriptionPlan = {
  code: string;
  name: string;
  price: number;
  currency: string;
  billingInterval: 'monthly' | 'yearly';
  trialDays: number;
  features: string[];
  modules: string[];
  employeeLimit: number | null;
  usageLimits: Record<string, number>;
  isActive: boolean;
};
type SubscriptionActivationRequest = {
  id: string;
  planCode: string;
  requestType: 'trial' | 'activation';
  requestedAt: string;
  organization: { id: string; name: string };
  requestedBy: { name: string; email: string };
};
type WorkspaceSignupRequest = {
  userId: string;
  requestedAt: string;
  user: { name: string; email: string };
  organization: { id: string; name: string };
};
type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: string;
};
type WorkspaceDeal = {
  id: string;
  name: string;
  value: number;
  status: string;
  closeDate: string | null;
  company: string | null;
  pipeline: string;
  stage: string;
  owner: { name: string; email: string };
};
type WorkspaceDealPage = {
  deals: WorkspaceDeal[];
  page: number;
  total: number;
};



type WorkspaceFilter = 'all' | 'needs-attention' | 'active';
type SubscriptionStatusFilter = 'all' | Organization['subscription']['status'];
type PendingSensitiveAction =
  | { kind: 'access'; organization: Organization; status: 'active' | 'suspended' }
  | { kind: 'subscription'; organization: Organization; status: 'active' | 'expired' | 'cancelled' }
  | { kind: 'modules'; organization: Organization; modules: string[] };

const crmModules = [
  ['leads', 'Leads'],
  ['contacts', 'Contacts'],
  ['companies', 'Companies'],
  ['deals', 'Deals'],
  ['activities', 'Activities'],
  ['team', 'Team'],
  ['automation', 'Automation'],
  ['email', 'Email'],
  ['reports', 'Reports'],
  ['audit-logs', 'Audit Logs'],
  ['settings', 'Settings'],
] as const;

const emptyPlan = {
  code: '',
  name: '',
  price: '0',
  currency: 'INR',
  billingInterval: 'monthly' as const,
  trialDays: '0',
  features: '',
  modules: ['leads', 'contacts', 'companies', 'deals', 'activities', 'team', 'settings'],
  employeeLimit: '',
  usageLimits: '{}',
  isActive: true,
};
type PlanFormState = Omit<typeof emptyPlan, 'billingInterval'> & {
  billingInterval: SubscriptionPlan['billingInterval'];
};
type AuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  reason?: string | null;
  metadata?: unknown;
  createdAt: string;
};

function isOrganization(value: unknown): value is Organization {
  if (typeof value !== 'object' || value === null) return false;
  const organization = value as Record<string, unknown>;
  return typeof organization.id === 'string' &&
    typeof organization.name === 'string' &&
    (organization.status === 'active' || organization.status === 'suspended') &&
    Number.isInteger(organization.memberCount) &&
    Number.isInteger(organization.pendingMemberRequestCount) &&
    Number.isInteger(organization.dealCount) &&
    typeof organization.openPipelineValue === 'number' &&
    Number.isFinite(organization.openPipelineValue) &&
    typeof organization.wonRevenue === 'number' &&
    Number.isFinite(organization.wonRevenue) &&
    typeof organization.currency === 'string' &&
    /^[A-Z]{3}$/.test(organization.currency) &&
    typeof organization.createdAt === 'string' &&
    Array.isArray(organization.enabledModules) &&
    organization.enabledModules.every((module) => typeof module === 'string') &&
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

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.code === 'string' &&
    typeof plan.name === 'string' &&
    typeof plan.price === 'number' &&
    typeof plan.currency === 'string' &&
    (plan.billingInterval === 'monthly' || plan.billingInterval === 'yearly') &&
    typeof plan.trialDays === 'number' &&
    Array.isArray(plan.features) &&
    Array.isArray(plan.modules) &&
    plan.modules.every((module) => typeof module === 'string') &&
    (plan.employeeLimit === null || typeof plan.employeeLimit === 'number') &&
    typeof plan.usageLimits === 'object' &&
    plan.usageLimits !== null &&
    typeof plan.isActive === 'boolean';
}

function isWorkspaceDeal(value: unknown): value is WorkspaceDeal {
  if (typeof value !== 'object' || value === null) return false;
  const deal = value as Record<string, unknown>;
  const owner = deal.owner;
  return typeof deal.id === 'string' &&
    typeof deal.name === 'string' &&
    typeof deal.value === 'number' &&
    Number.isFinite(deal.value) &&
    typeof deal.status === 'string' &&
    (deal.closeDate === null || typeof deal.closeDate === 'string') &&
    (deal.company === null || typeof deal.company === 'string') &&
    typeof deal.pipeline === 'string' &&
    typeof deal.stage === 'string' &&
    typeof owner === 'object' &&
    owner !== null &&
    typeof (owner as Record<string, unknown>).name === 'string' &&
    typeof (owner as Record<string, unknown>).email === 'string';
}

function auditSummary(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '—';
  const summary = JSON.stringify(value);
  return summary.length > 240 ? `${summary.slice(0, 237)}…` : summary;
}

function auditReason(log: AuditLog) {
  if (log.reason) return log.reason;
  if (typeof log.metadata === 'object' && log.metadata !== null && !Array.isArray(log.metadata)) {
    const metadataReason = (log.metadata as Record<string, unknown>).reason;
    if (typeof metadataReason === 'string') return metadataReason;
  }
  return '';
}

function localDateValue(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ControlPanelPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [activationRequests, setActivationRequests] = useState<SubscriptionActivationRequest[]>([]);
  const [workspaceSignupRequests, setWorkspaceSignupRequests] = useState<WorkspaceSignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOrganizationId, setBusyOrganizationId] = useState('');
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [adminMatchIds, setAdminMatchIds] = useState<string[]>([]);
  const [searchingAdmins, setSearchingAdmins] = useState(false);
  const [filter, setFilter] = useState<WorkspaceFilter>('all');
  const [accessStatusFilter, setAccessStatusFilter] = useState<'all' | Organization['status']>('all');
  const [subscriptionStatusFilter, setSubscriptionStatusFilter] = useState<SubscriptionStatusFilter>('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [onboarding, setOnboarding] = useState({ organizationName: '', ownerName: '', ownerEmail: '', ownerPassword: '', planCode: 'starter' });
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(true);
  const [onboardingMessage, setOnboardingMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, WorkspaceMember[] | undefined>>({});
  const [loadingMembers, setLoadingMembers] = useState<Record<string, boolean>>({});
  const [memberErrors, setMemberErrors] = useState<Record<string, string>>({});
  const [expandedDeals, setExpandedDeals] = useState<Record<string, WorkspaceDealPage | undefined>>({});
  const [loadingDeals, setLoadingDeals] = useState<Record<string, boolean>>({});
  const [dealErrors, setDealErrors] = useState<Record<string, string>>({});
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [selectedModules, setSelectedModules] = useState<Record<string, string[]>>({});
  const [accessEndDates, setAccessEndDates] = useState<Record<string, string>>({});
  const [planDraft, setPlanDraft] = useState<PlanFormState>(emptyPlan);
  const [editingPlanCode, setEditingPlanCode] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const [accessMessage, setAccessMessage] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<PendingSensitiveAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const actionDialogRef = useRef<HTMLDialogElement>(null);

  const activeSubscriptions = organizations.filter(({ subscription }) =>
    subscription.status === 'active').length;
  const attentionWorkspaces = organizations.filter(({ status, subscription }) =>
    status === 'suspended' || ['pending', 'expired', 'cancelled'].includes(subscription.status)).length;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleOrganizations = organizations.filter((organization) => {
    const matchesSearch = !normalizedSearch || [
      organization.name,
      organization.owner?.name,
      organization.owner?.email,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch)) ||
      adminMatchIds.includes(organization.id);
    const matchesQuickFilter = filter === 'all' ||
      (filter === 'active'
        ? organization.status === 'active' && ['active', 'trial'].includes(organization.subscription.status)
        : organization.status === 'suspended' || ['pending', 'expired', 'cancelled'].includes(organization.subscription.status));
    const createdDate = localDateValue(organization.createdAt);
    return matchesSearch &&
      matchesQuickFilter &&
      (accessStatusFilter === 'all' || organization.status === accessStatusFilter) &&
      (subscriptionStatusFilter === 'all' || organization.subscription.status === subscriptionStatusFilter) &&
      (planFilter === 'all' || organization.subscription.planCode === planFilter) &&
      (!createdAfter || createdDate >= createdAfter) &&
      (!createdBefore || createdDate <= createdBefore);
  });
  const auditActions = [...new Set(auditLogs.map((log) => log.action))].sort();
  const normalizedAuditSearch = auditSearch.trim().toLowerCase();
  const pendingActionPlanCode = pendingSensitiveAction?.kind === 'subscription' && pendingSensitiveAction.status === 'active'
    ? selectedPlans[pendingSensitiveAction.organization.id] ??
      pendingSensitiveAction.organization.subscription.planCode ??
      subscriptionPlans.find((plan) => plan.isActive)?.code
    : undefined;
  const pendingActionPlan = pendingActionPlanCode
    ? subscriptionPlans.find((plan) => plan.code === pendingActionPlanCode)
    : undefined;
  const visibleAuditLogs = auditLogs.filter((log) => {
    const matchesAction = auditActionFilter === 'all' || log.action === auditActionFilter;
    const matchesSearch = !normalizedAuditSearch || [
      log.action,
      log.targetType,
      log.targetId,
      log.actorName,
      log.actorEmail,
      auditReason(log),
      auditSummary(log.metadata),
    ].some((value) => value?.toLowerCase().includes(normalizedAuditSearch));
    return matchesAction && matchesSearch;
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
      setSelectedModules((current) => Object.fromEntries(
        (payload as { data: Organization[] }).data.map((organization) => [
          organization.id,
          current[organization.id] ?? organization.enabledModules,
        ]),
      ));
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

  async function loadPlans(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/plans', signal ? { signal } : {});
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not load subscription plans.');
      }
      if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data) || !(payload as { data: unknown[] }).data.every(isSubscriptionPlan)) {
        throw new Error('The control panel returned an invalid plan list.');
      }
      const plans = (payload as { data: SubscriptionPlan[] }).data;
      setSubscriptionPlans(plans);
      setOnboarding((current) => current.planCode === 'starter' && !plans.some((plan) => plan.code === 'starter' && plan.isActive)
        ? { ...current, planCode: plans.find((plan) => plan.isActive)?.code ?? 'pending' }
        : current);
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') {
        setError(caught instanceof Error ? caught.message : 'Could not load subscription plans.');
      }
    }
  }

  async function loadActivationRequests(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/subscription-activation-requests', signal ? { signal } : {});
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload
          ? (payload as { error?: { message?: string } }).error
          : undefined;
        throw new Error(body?.message ?? 'Could not load subscription activation requests.');
      }
      if (typeof payload !== 'object' || payload === null ||
        !Array.isArray((payload as { data?: unknown }).data) ||
        !(payload as { data: unknown[] }).data.every((request) =>
          typeof request === 'object' && request !== null &&
          typeof (request as SubscriptionActivationRequest).id === 'string' &&
          typeof (request as SubscriptionActivationRequest).planCode === 'string' &&
          ((request as SubscriptionActivationRequest).requestType === 'trial' || (request as SubscriptionActivationRequest).requestType === 'activation') &&
          typeof (request as SubscriptionActivationRequest).requestedAt === 'string' &&
          typeof (request as SubscriptionActivationRequest).organization?.id === 'string' &&
          typeof (request as SubscriptionActivationRequest).organization?.name === 'string' &&
          typeof (request as SubscriptionActivationRequest).requestedBy?.email === 'string',
        )) {
        throw new Error('The control panel returned invalid activation requests.');
      }
      setActivationRequests((payload as { data: SubscriptionActivationRequest[] }).data);
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') {
        setError(caught instanceof Error ? caught.message : 'Could not load subscription activation requests.');
      }
    }
  }

  async function loadWorkspaceSignupRequests(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/workspace-signups', signal ? { signal } : {});
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload
          ? (payload as { error?: { message?: string } }).error
          : undefined;
        throw new Error(body?.message ?? 'Could not load workspace signup requests.');
      }
      if (typeof payload !== 'object' || payload === null ||
        !Array.isArray((payload as { data?: unknown }).data) ||
        !(payload as { data: unknown[] }).data.every((item) =>
          typeof item === 'object' && item !== null &&
          typeof (item as WorkspaceSignupRequest).userId === 'string' &&
          typeof (item as WorkspaceSignupRequest).requestedAt === 'string' &&
          typeof (item as WorkspaceSignupRequest).user?.name === 'string' &&
          typeof (item as WorkspaceSignupRequest).user?.email === 'string' &&
          typeof (item as WorkspaceSignupRequest).organization?.name === 'string',
        )) {
        throw new Error('The control panel returned invalid workspace signup requests.');
      }
      setWorkspaceSignupRequests((payload as { data: WorkspaceSignupRequest[] }).data);
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') {
        setError(caught instanceof Error ? caught.message : 'Could not load workspace signup requests.');
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadOrganizations(controller.signal);
    void loadPlans(controller.signal);
    void loadActivationRequests(controller.signal);
    void loadWorkspaceSignupRequests(controller.signal);
    void loadAuditLogs();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setAdminMatchIds([]);
      setSearchingAdmins(false);
      return;
    }

    setAdminMatchIds([]);
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchingAdmins(true);
      try {
        const response = await crmApiFetch(
          `/control-panel/organizations/admin-search?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const payload: unknown = await response.json();
        if (!response.ok) {
          const apiError = typeof payload === 'object' && payload !== null && 'error' in payload
            ? (payload as { error?: { message?: string } }).error
            : undefined;
          throw new Error(apiError?.message ?? 'Could not search CRM administrators.');
        }
        if (typeof payload !== 'object' || payload === null ||
          !Array.isArray((payload as { data?: unknown }).data) ||
          !(payload as { data: unknown[] }).data.every((id) => typeof id === 'string')) {
          throw new Error('The control panel returned invalid administrator search results.');
        }
        setAdminMatchIds((payload as { data: string[] }).data);
      } catch (caught) {
        if (!(caught instanceof Error) || caught.name !== 'AbortError') {
          setAdminMatchIds([]);
          setError(caught instanceof Error ? caught.message : 'Could not search CRM administrators.');
        }
      } finally {
        if (!controller.signal.aborted) setSearchingAdmins(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [search]);
  useEffect(() => {
    const dialog = actionDialogRef.current;
    if (pendingSensitiveAction && dialog && !dialog.open) dialog.showModal();
  }, [pendingSensitiveAction]);

  async function refreshOrganizations() {
    setRefreshing(true);
    setLoading(true);
    await loadOrganizations();
    await loadActivationRequests();
    await loadWorkspaceSignupRequests();
  }

  async function reviewWorkspaceSignup(signup: WorkspaceSignupRequest, decision: 'approve' | 'decline') {
    setBusyOrganizationId(signup.userId);
    setError('');
    setAccessMessage('');
    try {
      const response = await crmApiFetch(`/control-panel/workspace-signups/${signup.userId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? 'Could not review this workspace signup.');
      setAccessMessage(`${signup.organization.name} was ${decision === 'approve' ? 'approved' : 'declined'}.`);
      await Promise.all([loadWorkspaceSignupRequests(), loadOrganizations(), loadAuditLogs()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not review this workspace signup.');
    } finally {
      setBusyOrganizationId('');
    }
  }

  async function reviewSubscriptionRequest(subscriptionRequest: SubscriptionActivationRequest, decision: 'approve' | 'decline') {
    setBusyOrganizationId(subscriptionRequest.organization.id);
    setError('');
    setAccessMessage('');
    try {
      const response = await crmApiFetch(`/control-panel/subscription-activation-requests/${subscriptionRequest.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload
          ? (payload as { error?: { message?: string } }).error
          : undefined;
        throw new Error(apiError?.message ?? 'Could not review this subscription request.');
      }
      setAccessMessage(
        subscriptionRequest.requestType === 'trial'
          ? `Trial request for ${subscriptionRequest.organization.name} ${decision === 'approve' ? 'approved; the two-day trial has started' : 'declined'}.`
          : `Plan request for ${subscriptionRequest.organization.name} ${decision === 'approve' ? 'manually activated' : 'declined'}. No payment was collected or verified.`,
      );
      await Promise.all([loadActivationRequests(), loadOrganizations(), loadAuditLogs()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not review this subscription request.');
    } finally {
      setBusyOrganizationId('');
    }
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
      setOnboarding({
        organizationName: '',
        ownerName: '',
        ownerEmail: '',
        ownerPassword: '',
        planCode: subscriptionPlans.find((plan) => plan.isActive)?.code ?? 'pending',
      });
      await loadOrganizations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create workspace.');
    } finally {
      setOnboardingBusy(false);
    }
  }

  async function savePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPlan(true);
    setError('');
    setPlanMessage('');
    try {
      let usageLimits: unknown;
      try {
        usageLimits = JSON.parse(planDraft.usageLimits);
      } catch {
        throw new Error('Usage limits must be valid JSON.');
      }
      const body = {
        code: planDraft.code,
        name: planDraft.name,
        price: Number(planDraft.price),
        currency: planDraft.currency,
        billingInterval: planDraft.billingInterval,
        trialDays: Number(planDraft.trialDays),
        features: planDraft.features.split('\n').map((feature) => feature.trim()).filter(Boolean),
        modules: planDraft.modules,
        employeeLimit: planDraft.employeeLimit === '' ? null : Number(planDraft.employeeLimit),
        usageLimits,
        isActive: planDraft.isActive,
      };
      const response = await crmApiFetch(
        editingPlanCode ? `/control-panel/plans/${encodeURIComponent(editingPlanCode)}` : '/control-panel/plans',
        {
          method: editingPlanCode ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(apiError?.message ?? 'Could not save subscription plan.');
      }
      await loadPlans();
      setPlanMessage(`${planDraft.name} ${editingPlanCode ? 'updated' : 'created'}.`);
      setPlanDraft(emptyPlan);
      setEditingPlanCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save subscription plan.');
    } finally {
      setSavingPlan(false);
    }
  }

  function editPlan(plan: SubscriptionPlan) {
    setEditingPlanCode(plan.code);
    setPlanDraft({
      code: plan.code,
      name: plan.name,
      price: String(plan.price),
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      trialDays: String(plan.trialDays),
      features: plan.features.join('\n'),
      modules: plan.modules,
      employeeLimit: plan.employeeLimit === null ? '' : String(plan.employeeLimit),
      usageLimits: JSON.stringify(plan.usageLimits, null, 2),
      isActive: plan.isActive,
    });
    setPlanMessage('');
  }

  async function togglePlanActive(plan: SubscriptionPlan) {
    const action = plan.isActive ? 'deactivate' : 'activate';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} the ${plan.name} plan?`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/plans/${encodeURIComponent(plan.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !plan.isActive }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(apiError?.message ?? `Could not ${action} plan.`);
      }
      await loadPlans();
      setPlanMessage(`${plan.name} ${action}d.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not ${action} plan.`);
    }
  }

  async function saveOrganizationModules(organization: Organization, modules: string[], reason: string) {
    setBusyOrganizationId(organization.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules, reason }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(apiError?.message ?? 'Could not update tenant modules.');
      }
      setOrganizations((current) => current.map((item) => item.id === organization.id ? { ...item, enabledModules: modules } : item));
      setExpandedModules((current) => ({ ...current, [organization.id]: false }));
      setAccessMessage(`Module access updated for ${organization.name}.`);
      await loadAuditLogs();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update tenant modules.');
      return false;
    } finally {
      setBusyOrganizationId('');
    }
  }

  async function loadAuditLogs() {
    setLoadingAuditLogs(true);
    try {
      const response = await crmApiFetch('/control-panel/audit-logs?limit=50');
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid audit log.'); }
      if (!response.ok || typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(apiError?.message ?? 'Could not load the audit log.');
      }
      setAuditLogs((payload as { data: AuditLog[] }).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the audit log.');
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

  async function loadOrganizationDeals(organization: Organization, page: number, append: boolean) {
    setLoadingDeals((current) => ({ ...current, [organization.id]: true }));
    setDealErrors((current) => ({ ...current, [organization.id]: '' }));
    try {
      const response = await crmApiFetch(
        `/control-panel/organizations/${encodeURIComponent(organization.id)}/deals?page=${page}&pageSize=25`,
      );
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not load workspace deals.');
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !Array.isArray((payload as { data?: unknown }).data) ||
        !(payload as { data: unknown[] }).data.every(isWorkspaceDeal) ||
        typeof (payload as { meta?: unknown }).meta !== 'object' ||
        (payload as { meta?: unknown }).meta === null ||
        !Number.isInteger((payload as { meta: { page?: unknown } }).meta.page) ||
        !Number.isInteger((payload as { meta: { total?: unknown } }).meta.total) ||
        ((payload as { meta: { total: number } }).meta.total < 0)
      ) {
        throw new Error('The control panel returned an invalid deal list.');
      }
      const data = (payload as { data: WorkspaceDeal[]; meta: { page: number; total: number } });
      setExpandedDeals((current) => ({
        ...current,
        [organization.id]: {
          deals: append ? [...(current[organization.id]?.deals ?? []), ...data.data] : data.data,
          page: data.meta.page,
          total: data.meta.total,
        },
      }));
    } catch (caught) {
      setDealErrors((current) => ({
        ...current,
        [organization.id]: caught instanceof Error ? caught.message : 'Could not load workspace deals.',
      }));
    } finally {
      setLoadingDeals((current) => ({ ...current, [organization.id]: false }));
    }
  }

  function toggleDeals(organization: Organization) {
    if (expandedDeals[organization.id] !== undefined) {
      setExpandedDeals((current) => ({ ...current, [organization.id]: undefined }));
      return;
    }
    setExpandedDeals((current) => ({
      ...current,
      [organization.id]: { deals: [], page: 0, total: organization.dealCount },
    }));
    void loadOrganizationDeals(organization, 1, false);
  }

  function loadMoreDeals(organization: Organization) {
    const current = expandedDeals[organization.id];
    if (current && !loadingDeals[organization.id] && current.deals.length < current.total) {
      void loadOrganizationDeals(organization, current.page + 1, true);
    }
  }



  function requestOrganizationStatus(organization: Organization) {
    setActionReason('');
    setPendingSensitiveAction({
      kind: 'access',
      organization,
      status: organization.status === 'active' ? 'suspended' : 'active',
    });
  }

  function requestSubscriptionStatus(organization: Organization, status: 'active' | 'expired' | 'cancelled') {
    setActionReason('');
    setPendingSensitiveAction({ kind: 'subscription', organization, status });
  }

  function requestModuleSave(organization: Organization) {
    setActionReason('');
    setPendingSensitiveAction({
      kind: 'modules',
      organization,
      modules: selectedModules[organization.id] ?? organization.enabledModules,
    });
  }

  function closeSensitiveAction() {
    if (actionDialogRef.current?.open) actionDialogRef.current.close();
    setPendingSensitiveAction(null);
    setActionReason('');
  }

  async function confirmSensitiveAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = pendingSensitiveAction;
    const reason = actionReason.trim();
    if (!action || !reason) return;

    if (action.kind === 'access') {
      await setOrganizationStatus(action.organization, action.status, reason);
    } else if (action.kind === 'subscription') {
      await setSubscriptionStatus(action.organization, action.status, reason);
    } else {
      await saveOrganizationModules(action.organization, action.modules, reason);
    }
    closeSensitiveAction();
  }

  async function setOrganizationStatus(
    organization: Organization,
    status: 'active' | 'suspended',
    reason: string,
  ): Promise<boolean> {
    setBusyOrganizationId(organization.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error('The control panel returned an invalid response.'); }
      if (!response.ok) {
        const body = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(body?.message ?? 'Could not update workspace access.');
      }
      setOrganizations((current) => current.map((item) => item.id === organization.id ? { ...item, status } : item));
      setAccessMessage(`${organization.name} access ${status === 'active' ? 'restored' : 'suspended'}.`);
      await loadAuditLogs();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update workspace access.');
      return false;
    } finally {
      setBusyOrganizationId('');
    }
  }

  async function setSubscriptionStatus(
    organization: Organization,
    status: 'active' | 'expired' | 'cancelled',
    reason: string,
  ): Promise<boolean> {
    const activeDefault = subscriptionPlans.find((plan) => plan.isActive)?.code ?? '';
    const currentPlanAvailable = subscriptionPlans.some((plan) => plan.code === organization.subscription.planCode && plan.isActive);
    const planCode = selectedPlans[organization.id] ?? (currentPlanAvailable ? organization.subscription.planCode : activeDefault) ?? '';
    setBusyOrganizationId(organization.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/organizations/${organization.id}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          reason,
          ...(status === 'active' ? {
            planCode,
            extend: organization.subscription.status === 'active' && organization.subscription.planCode === planCode,
            ...(accessEndDates[organization.id]
              ? { endsAt: new Date(`${accessEndDates[organization.id]}T23:59:59`).toISOString() }
              : {}),
          } : {}),
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
      setAccessEndDates((dates) => ({ ...dates, [organization.id]: '' }));
      setAccessMessage(`Subscription access updated for ${organization.name}. No payment was collected.`);
      await loadAuditLogs();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update subscription.');
      return false;
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
        {accessMessage && <p className="control-panel-success control-panel-access-message" role="status">{accessMessage}</p>}

        <section id="overview" className="control-panel-metrics" aria-label="Workspace summary">
          <article className="control-panel-metric">
            <span className="control-panel-metric-icon violet">▦</span>
            <div><p>Total tenants</p><strong>{loading ? '—' : organizations.length}</strong></div>
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
        <p className="control-panel-billing-note">Workspace revenue shows won CRM deal value; open deal value is shown separately as pipeline. Payment revenue is unavailable because no payment ledger is connected.</p>
        <nav className="control-panel-nav" aria-label="Control panel sections">
          <a href="#overview">Overview</a>
          <a href="#onboarding">Onboard workspace</a>
          <a href="#plans">Subscription plans</a>
          <a href="#workspace-signups">Workspace approvals</a>
          <a href="#activation-requests">Activation requests</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#audit-log">Audit log</a>
        </nav>

        <section id="workspace-signups" className="panel control-panel-table" aria-label="Workspace signup approvals">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Workspace signup approvals</h2>
              <p>{workspaceSignupRequests.length} awaiting platform-admin review</p>
            </div>
          </div>
          {workspaceSignupRequests.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>WORKSPACE</th><th>REQUESTED BY</th><th>REQUESTED</th><th>ACTION</th></tr></thead>
                <tbody>{workspaceSignupRequests.map((signup) => (
                  <tr key={signup.userId}>
                    <td><strong>{signup.organization.name}</strong></td>
                    <td>{signup.user.name}<small>{signup.user.email}</small></td>
                    <td>{new Date(signup.requestedAt).toLocaleDateString()}</td>
                    <td>
                      <button className="control-panel-action" type="button" disabled={Boolean(busyOrganizationId)} onClick={() => void reviewWorkspaceSignup(signup, 'approve')}>Allow</button>
                      {' '}
                      <button className="control-panel-action" type="button" disabled={Boolean(busyOrganizationId)} onClick={() => void reviewWorkspaceSignup(signup, 'decline')}>Decline</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="control-panel-empty">No workspace signups are waiting for approval.</p>}
        </section>

        <section id="activation-requests" className="panel control-panel-table" aria-label="Subscription activation requests">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Activation requests</h2>
              <p>{activationRequests.length} trial and plan requests awaiting review</p>
            </div>
          </div>
          {activationRequests.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>WORKSPACE</th><th>REQUESTED BY</th><th>REQUEST</th><th>PLAN</th><th>REQUESTED</th><th>ACTION</th></tr></thead>
                <tbody>{activationRequests.map((activationRequest) => (
                  <tr key={activationRequest.id}>
                    <td><strong>{activationRequest.organization.name}</strong></td>
                    <td>{activationRequest.requestedBy.name}<small>{activationRequest.requestedBy.email}</small></td>
                    <td>{activationRequest.requestType === 'trial' ? '2-day trial' : 'Plan activation'}</td>
                    <td>{subscriptionPlans.find((plan) => plan.code === activationRequest.planCode)?.name ?? activationRequest.planCode}</td>
                    <td>{new Date(activationRequest.requestedAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="control-panel-action primary"
                        type="button"
                        disabled={Boolean(busyOrganizationId)}
                        onClick={() => void reviewSubscriptionRequest(activationRequest, 'approve')}
                      >
                        {activationRequest.requestType === 'trial' ? 'Approve trial' : 'Activate manually'}
                      </button>
                      {' '}
                      <button
                        className="control-panel-action"
                        type="button"
                        disabled={Boolean(busyOrganizationId)}
                        onClick={() => void reviewSubscriptionRequest(activationRequest, 'decline')}
                      >Decline</button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="control-panel-empty">No trial or plan requests are waiting.</p>}
        </section>

        <section id="onboarding" className="panel control-panel-onboarding" aria-label="Onboard customer workspace">
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
                {subscriptionPlans.filter((plan) => plan.isActive).map((plan) => (
                  <option key={plan.code} value={plan.code}>
                    {plan.name} · {plan.trialDays > 0 ? `${plan.trialDays}-day trial` : plan.billingInterval}
                  </option>
                ))}
              </select>
            </label>
            <button suppressHydrationWarning className="control-panel-action primary" type="submit" disabled={onboardingBusy}>{onboardingBusy ? 'Creating…' : 'Create workspace'}</button>
          </form>
        </section>

        <section id="plans" className="panel control-panel-plan-management" aria-label="Subscription plans">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Subscription plans</h2>
                <p>Persisted plans used when onboarding tenants and setting access. Employee caps and selected modules are enforced. Plan changes do not process payments.</p>
            </div>
          </div>
          {planMessage && <p className="control-panel-success" role="status">{planMessage}</p>}
          <div className="table-scroll control-panel-plan-table">
            <table>
              <thead><tr><th>PLAN</th><th>PRICE</th><th>INTERVAL</th><th>TRIAL</th><th>EMPLOYEES</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
              <tbody>
                {subscriptionPlans.map((plan) => (
                  <tr key={plan.code}>
                    <td><strong>{plan.name}</strong><small>{plan.code}</small></td>
                    <td>{plan.currency} {plan.price.toLocaleString()}</td>
                    <td>{plan.billingInterval}</td>
                    <td>{plan.trialDays} days</td>
                    <td>{plan.employeeLimit ?? 'Unlimited'}</td>
                    <td><span className={`control-panel-status ${plan.isActive ? 'active' : 'cancelled'}`}>{plan.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div className="control-panel-plan-actions">
                        <button className="control-panel-action" type="button" onClick={() => editPlan(plan)}>Edit</button>
                        <button className="control-panel-action" type="button" onClick={() => void togglePlanActive(plan)}>{plan.isActive ? 'Deactivate' : 'Activate'}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {subscriptionPlans.length === 0 && <tr><td colSpan={7} className="control-panel-empty">No plans found. Create your first plan below.</td></tr>}
              </tbody>
            </table>
          </div>
          <form className="control-panel-plan-form control-panel-onboarding-form" onSubmit={(event) => void savePlan(event)}>
            <h3>{editingPlanCode ? `Edit ${editingPlanCode}` : 'Create a plan'}</h3>
            <label>Plan code<input value={planDraft.code} disabled={Boolean(editingPlanCode)} required pattern="[a-z0-9][a-z0-9-]{1,31}" onChange={(event) => setPlanDraft((current) => ({ ...current, code: event.target.value.toLowerCase() }))} placeholder="team-monthly" /></label>
            <label>Plan name<input value={planDraft.name} required maxLength={80} onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Team Monthly" /></label>
            <label>Price (whole units)<input type="number" min="0" step="1" value={planDraft.price} required onChange={(event) => setPlanDraft((current) => ({ ...current, price: event.target.value }))} /></label>
            <label>Currency<input value={planDraft.currency} required maxLength={3} onChange={(event) => setPlanDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
            <label>Billing interval<select value={planDraft.billingInterval} onChange={(event) => setPlanDraft((current) => ({ ...current, billingInterval: event.target.value as SubscriptionPlan['billingInterval'] }))}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>
            <label>Trial days<input type="number" min="0" max="365" step="1" value={planDraft.trialDays} onChange={(event) => setPlanDraft((current) => ({ ...current, trialDays: event.target.value }))} /></label>
            <label>Employee limit<input type="number" min="1" step="1" value={planDraft.employeeLimit} onChange={(event) => setPlanDraft((current) => ({ ...current, employeeLimit: event.target.value }))} placeholder="Blank means unlimited" /></label>
            <label>Features (one per line)<textarea rows={4} value={planDraft.features} onChange={(event) => setPlanDraft((current) => ({ ...current, features: event.target.value }))} /></label>
            <fieldset className="control-panel-module-options">
              <legend>Modules included in this plan</legend>
              {crmModules.map(([module, label]) => (
                <label className="control-panel-checkbox" key={module}>
                  <input
                    type="checkbox"
                    checked={planDraft.modules.includes(module)}
                    onChange={(event) => setPlanDraft((current) => ({
                      ...current,
                      modules: event.target.checked
                        ? [...current.modules, module]
                        : current.modules.filter((item) => item !== module),
                    }))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label>Additional usage limits (JSON; metadata only)<textarea rows={4} value={planDraft.usageLimits} onChange={(event) => setPlanDraft((current) => ({ ...current, usageLimits: event.target.value }))} /></label>
            <label className="control-panel-checkbox"><input type="checkbox" checked={planDraft.isActive} onChange={(event) => setPlanDraft((current) => ({ ...current, isActive: event.target.checked }))} /> Active and available for assignment</label>
            <div className="control-panel-plan-form-actions">
              <button className="control-panel-action primary" type="submit" disabled={savingPlan}>{savingPlan ? 'Saving…' : editingPlanCode ? 'Save plan' : 'Create plan'}</button>
              {editingPlanCode && <button className="control-panel-action" type="button" onClick={() => { setEditingPlanCode(''); setPlanDraft(emptyPlan); }}>Cancel edit</button>}
            </div>
          </form>
        </section>

        <section id="workspaces" className="panel control-panel-table" aria-label="Customer workspaces">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Workspaces</h2>
              <p>{visibleOrganizations.length} of {organizations.length} customer {organizations.length === 1 ? 'workspace' : 'workspaces'}</p>
            </div>
            <label className="control-panel-search">
              <span aria-hidden="true">⌕</span>
              <input aria-label="Search workspaces and CRM administrators" maxLength={254} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workspace or CRM admin" />
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
          <div className="control-panel-filter-fields" role="group" aria-label="Additional workspace filters">
            <label>
              <span>Access</span>
              <select value={accessStatusFilter} onChange={(event) => setAccessStatusFilter(event.target.value as typeof accessStatusFilter)}>
                <option value="all">All access states</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <label>
              <span>Subscription</span>
              <select value={subscriptionStatusFilter} onChange={(event) => setSubscriptionStatusFilter(event.target.value as SubscriptionStatusFilter)}>
                <option value="all">All subscription states</option>
                <option value="pending">Pending</option>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label>
              <span>Plan</span>
              <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
                <option value="all">All plans</option>
                {subscriptionPlans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
              </select>
            </label>
            <label>
              <span>Signed up from</span>
              <input type="date" value={createdAfter} onChange={(event) => setCreatedAfter(event.target.value)} />
            </label>
            <label>
              <span>Signed up to</span>
              <input type="date" value={createdBefore} onChange={(event) => setCreatedBefore(event.target.value)} />
            </label>
            <button
              className="control-panel-filter-reset"
              type="button"
              disabled={filter === 'all' && !search && accessStatusFilter === 'all' && subscriptionStatusFilter === 'all' && planFilter === 'all' && !createdAfter && !createdBefore}
              onClick={() => {
              setFilter('all');
              setSearch('');
              setAccessStatusFilter('all');
              setSubscriptionStatusFilter('all');
              setPlanFilter('all');
              setCreatedAfter('');
              setCreatedBefore('');
            }}
            >
            Reset filters
            </button>
          </div>
          {searchingAdmins && <p className="control-panel-filter-status" role="status">Searching CRM administrator accounts…</p>}
          <p className="control-panel-filter-status">Seat usage includes active members and unexpired invitations, matching the API seat-limit rule.</p>
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
                    <th scope="col" aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrganizations.map((organization) => {
                    const hasActiveSubscription = organization.subscription.status === 'active' || organization.subscription.status === 'trial';
                    const activeDefault = subscriptionPlans.find((plan) => plan.isActive)?.code ?? '';
                    const currentPlanAvailable = subscriptionPlans.some((plan) => plan.code === organization.subscription.planCode && plan.isActive);
                    const selectedPlan = selectedPlans[organization.id] ?? (currentPlanAvailable ? organization.subscription.planCode : activeDefault) ?? '';
                    const selectedPlanRecord = subscriptionPlans.find((plan) => plan.code === selectedPlan);
                    const tenantPlan = subscriptionPlans.find((plan) => plan.code === organization.subscription.planCode);
                    const seatLimit = tenantPlan?.employeeLimit;
                    const seatsUsed = organization.memberCount + organization.pendingMemberRequestCount;
                    const seatLimitStatus = seatLimit === null || seatLimit === undefined
                      ? null
                      : seatsUsed > seatLimit ? 'over' : seatsUsed === seatLimit ? 'at' : null;
                    const currentPlanName = selectedPlanRecord?.name ?? selectedPlan;
                    return (
                    <Fragment key={organization.id}>
                    <tr>
                      <td>
                        <div className="control-panel-workspace"><span className="control-panel-workspace-avatar">{organization.name.slice(0, 1).toUpperCase()}</span><strong>{organization.name}</strong></div>
                        <small className="control-panel-revenue-summary">
                          {organization.dealCount} deals · {organization.currency} {organization.wonRevenue.toLocaleString()} won · {organization.currency} {organization.openPipelineValue.toLocaleString()} open
                        </small>
                      </td>
                      <td>{organization.owner ? <div className="control-panel-owner"><strong>{organization.owner.name}</strong><span>{organization.owner.email}</span></div> : '—'}</td>
                      <td>
                        <div className={`control-panel-seat-usage${seatLimitStatus ? ' at-limit' : ''}`}>
                          <button
                            suppressHydrationWarning
                            className="control-panel-member-count control-panel-member-toggle"
                            type="button"
                            onClick={() => void toggleMembers(organization)}
                            aria-expanded={Boolean(expandedMembers[organization.id])}
                            aria-label={`View ${organization.memberCount} active members for ${organization.name}`}
                          >
                            {organization.memberCount} active {expandedMembers[organization.id] ? '▲' : '▼'}
                          </button>
                          <button
                            className="control-panel-member-count control-panel-member-toggle"
                            type="button"
                            onClick={() => toggleDeals(organization)}
                            aria-expanded={expandedDeals[organization.id] !== undefined}
                            aria-label={`View ${organization.dealCount} deals for ${organization.name}`}
                          >
                            {expandedDeals[organization.id] !== undefined ? 'Hide deals' : 'View deals'} ({organization.dealCount})
                          </button>
                          <small>
                            {tenantPlan
                              ? tenantPlan.employeeLimit === null
                                ? `${seatsUsed} / Unlimited seats`
                                : `${seatsUsed} / ${tenantPlan.employeeLimit} seats`
                              : organization.subscription.planCode
                                ? `${seatsUsed} seats · plan limit unavailable`
                                : `${seatsUsed} seats · no plan assigned`}
                          </small>
                          {organization.pendingMemberRequestCount > 0 && (
                            <small>{organization.pendingMemberRequestCount} pending join requests included</small>
                          )}
                          {seatLimitStatus && (
                            <small className="control-panel-seat-limit-warning">
                              {seatLimitStatus === 'over' ? 'Over seat limit' : 'At seat limit'}
                            </small>
                          )}
                        </div>
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
                          <select aria-label={`Plan for ${organization.name}`} id={`plan-${organization.id}`} value={selectedPlan} disabled={busyOrganizationId === organization.id} onChange={(event) => setSelectedPlans((plans) => ({ ...plans, [organization.id]: event.target.value }))}>
                            {organization.subscription.planCode && !subscriptionPlans.some((plan) => plan.code === organization.subscription.planCode) && (
                              <option value={organization.subscription.planCode} disabled>{organization.subscription.planCode} (unavailable)</option>
                            )}
                            {subscriptionPlans.filter((plan) => plan.isActive).map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {plan.billingInterval}</option>)}
                          </select>
                          <input aria-label={`Optional access end date for ${organization.name}`} className="control-panel-end-date" id={`access-end-${organization.id}`} type="date" value={accessEndDates[organization.id] ?? ''} disabled={busyOrganizationId === organization.id} onChange={(event) => setAccessEndDates((dates) => ({ ...dates, [organization.id]: event.target.value }))} />
                          <button suppressHydrationWarning className="control-panel-action primary" type="button" disabled={busyOrganizationId === organization.id || !subscriptionPlans.some((plan) => plan.isActive)} onClick={() => requestSubscriptionStatus(organization, 'active')}>
                            {busyOrganizationId === organization.id
                              ? 'Saving…'
                              : hasActiveSubscription && selectedPlan === organization.subscription.planCode
                                ? `Extend ${selectedPlanRecord?.billingInterval ?? 'plan'}`
                                : hasActiveSubscription
                                  ? `Change to ${currentPlanName}`
                                : organization.subscription.status === 'expired'
                                  ? `Reactivate ${currentPlanName}`
                                  : `Activate ${currentPlanName}`}
                          </button>
                          <button className="control-panel-action" type="button" aria-expanded={Boolean(expandedModules[organization.id])} disabled={busyOrganizationId === organization.id} onClick={() => setExpandedModules((current) => ({ ...current, [organization.id]: !current[organization.id] }))}>
                            Modules
                          </button>
                          {hasActiveSubscription
                            ? <>
  <button suppressHydrationWarning className="control-panel-action danger" type="button" disabled={busyOrganizationId === organization.id} onClick={() => requestSubscriptionStatus(organization, 'expired')}>Expire now</button>
  <button suppressHydrationWarning className="control-panel-action danger" type="button" disabled={busyOrganizationId === organization.id} onClick={() => requestSubscriptionStatus(organization, 'cancelled')}>Cancel plan</button>
</>
                            : null}
                          <button suppressHydrationWarning className="control-panel-action" type="button" disabled={busyOrganizationId === organization.id} onClick={() => requestOrganizationStatus(organization)}>
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
                     {expandedDeals[organization.id] !== undefined && (
                       <tr className="control-panel-members-row">
                         <td colSpan={8}>
                           {loadingDeals[organization.id] ? (
                             <p className="control-panel-empty">Loading deals…</p>
                           ) : dealErrors[organization.id] ? (
                             <p className="control-panel-error" role="alert">{dealErrors[organization.id]}</p>
                           ) : expandedDeals[organization.id]?.deals.length ? (
                             <>
                               <div className="control-panel-deals-scroll">
                                 <table className="control-panel-members-table control-panel-deals-table">
                                   <thead><tr><th>DEAL</th><th>COMPANY</th><th>STATUS</th><th>PIPELINE</th><th>OWNER</th><th>CLOSE DATE</th><th>VALUE</th></tr></thead>
                                   <tbody>
                                     {expandedDeals[organization.id]?.deals.map((deal) => (
                                       <tr key={deal.id}>
                                         <td>{deal.name}</td>
                                         <td>{deal.company ?? '—'}</td>
                                         <td><span className={`control-panel-status ${deal.status}`}>{deal.status}</span></td>
                                         <td>{deal.pipeline} · {deal.stage}</td>
                                         <td>{deal.owner.name}<br /><small>{deal.owner.email}</small></td>
                                         <td>{deal.closeDate ? new Date(deal.closeDate).toLocaleDateString() : '—'}</td>
                                         <td>{organization.currency} {deal.value.toLocaleString()}</td>
                                       </tr>
                                     ))}
                                   </tbody>
                                 </table>
                               </div>
                               {expandedDeals[organization.id]!.deals.length < expandedDeals[organization.id]!.total && (
                                 <button className="control-panel-action" type="button" disabled={loadingDeals[organization.id]} onClick={() => loadMoreDeals(organization)}>
                                   {loadingDeals[organization.id] ? 'Loading…' : `Load more deals (${expandedDeals[organization.id]!.deals.length} of ${expandedDeals[organization.id]!.total})`}
                                 </button>
                               )}
                             </>
                           ) : (
                             <p className="control-panel-empty">No active CRM deals.</p>
                           )}
                         </td>
                       </tr>
                     )}
                     {expandedModules[organization.id] && (
                       <tr className="control-panel-members-row">
                         <td colSpan={8}>
                           <div className="control-panel-module-editor">
                             <div>
                               <strong>Enabled CRM modules</strong>
                               <p>Changes take effect immediately for this tenant’s users and API access.</p>
                             </div>
                             <div className="control-panel-module-options">
                               {crmModules.map(([module, label]) => {
                                 const modules = selectedModules[organization.id] ?? organization.enabledModules;
                                 return (
                                   <label key={module}>
                                     <input
                                       type="checkbox"
                                       checked={modules.includes(module)}
                                       onChange={(event) => setSelectedModules((current) => ({
                                         ...current,
                                         [organization.id]: event.target.checked
                                           ? [...modules, module]
                                           : modules.filter((value) => value !== module),
                                       }))}
                                     />
                                     {label}
                                   </label>
                                 );
                               })}
                             </div>
                             <button className="control-panel-action primary" type="button" disabled={busyOrganizationId === organization.id} onClick={() => requestModuleSave(organization)}>
                               {busyOrganizationId === organization.id ? 'Saving…' : 'Save module access'}
                             </button>
                           </div>
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
        <section id="audit-log" className="panel control-panel-audit" aria-label="Audit log">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Audit log</h2>
              <p>Showing the latest 50 platform administrator actions. Older entries are not included here.</p>
            </div>
            <button suppressHydrationWarning className="control-panel-action" type="button" disabled={loadingAuditLogs} onClick={() => void loadAuditLogs()}>
              {loadingAuditLogs ? 'Loading…' : 'Load audit log'}
            </button>
          </div>
          {auditLogs.length > 0 && (
            <div className="control-panel-audit-filters" role="group" aria-label="Filter audit entries">
              <label className="control-panel-search">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search audit entries"
                  value={auditSearch}
                  onChange={(event) => setAuditSearch(event.target.value)}
                  placeholder="Search action, target, actor, or reason"
                />
              </label>
              <label className="control-panel-audit-action-filter">
                <span>Action</span>
                <select value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value)}>
                  <option value="all">All actions</option>
                  {auditActions.map((action) => <option key={action} value={action}>{action}</option>)}
                </select>
              </label>
              <span className="control-panel-audit-count">{visibleAuditLogs.length} of {auditLogs.length} recent entries</span>
            </div>
          )}
          {auditLogs.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th>TIME</th><th>ACTION</th><th>TARGET</th><th>REASON</th><th>CHANGES</th><th>ACTOR</th></tr></thead>
                <tbody>
                  {visibleAuditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString()}</td>
                      <td>{log.action}</td>
                      <td>{log.targetType}{log.targetId ? ` · ${log.targetId}` : ''}</td>
                      <td>{auditReason(log) || '—'}</td>
                      <td className="control-panel-audit-details">{auditSummary(log.metadata)}</td>
                      <td>{log.actorName ?? log.actorEmail ?? log.actorUserId ?? '—'}{log.actorName && log.actorEmail ? <small>{log.actorEmail}</small> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loadingAuditLogs && <p className="control-panel-empty" role="status">Loading recent activity…</p>}
          {!loadingAuditLogs && auditLogs.length === 0 && <p className="control-panel-empty">No administrative activity recorded yet.</p>}
          {!loadingAuditLogs && auditLogs.length > 0 && visibleAuditLogs.length === 0 && <p className="control-panel-empty">No recent audit entries match these filters.</p>}
        </section>

        <p className="control-panel-note">Plan and access changes are manual unless an existing billing provider records a payment. Suspended workspaces remain blocked until restored. Tenant member details are limited to account and role information.</p>
      </div>
      {pendingSensitiveAction && (
        <dialog
          ref={actionDialogRef}
          className="control-panel-confirmation"
          aria-labelledby="control-panel-confirmation-title"
          onCancel={(event) => {
            event.preventDefault();
            closeSensitiveAction();
          }}
        >
          <form onSubmit={(event) => void confirmSensitiveAction(event)}>
            <p className="control-panel-confirmation-eyebrow">CONFIRM ADMIN ACTION</p>
            <h2 id="control-panel-confirmation-title">
              {pendingSensitiveAction.kind === 'access'
                ? pendingSensitiveAction.status === 'suspended' ? 'Suspend workspace access?' : 'Restore workspace access?'
                : pendingSensitiveAction.kind === 'subscription'
                  ? pendingSensitiveAction.status === 'active' ? 'Manually activate subscription?' : pendingSensitiveAction.status === 'expired' ? 'Expire subscription?' : 'Cancel subscription?'
                  : 'Update CRM module access?'}
            </h2>
            <p className="control-panel-confirmation-copy">
              {pendingSensitiveAction.kind === 'access'
                ? pendingSensitiveAction.status === 'suspended'
                  ? `${pendingSensitiveAction.organization.name} members will lose CRM access.`
                  : `Members of ${pendingSensitiveAction.organization.name} will regain CRM access.`
                : pendingSensitiveAction.kind === 'subscription'
                  ? pendingSensitiveAction.status === 'active'
                    ? `Manually assign ${pendingActionPlan?.name ?? pendingActionPlanCode ?? 'the selected plan'} to ${pendingSensitiveAction.organization.name}. No payment will be collected.`
                    : `This changes the subscription status for ${pendingSensitiveAction.organization.name}.`
                  : `Changes take effect immediately for ${pendingSensitiveAction.organization.name}.`}
            </p>
            {pendingSensitiveAction.kind === 'modules' && pendingSensitiveAction.organization.enabledModules.some((module) => !pendingSensitiveAction.modules.includes(module)) && (
              <p className="control-panel-confirmation-warning">Disabling modules immediately removes member access to their CRM pages and APIs.</p>
            )}
            <label className="control-panel-confirmation-reason">
              Reason <span>(required; recorded in the audit log)</span>
              <textarea
                autoFocus
                required
                maxLength={500}
                rows={3}
                value={actionReason}
                onChange={(event) => setActionReason(event.target.value)}
                placeholder="Briefly explain why this change is needed"
              />
            </label>
            <div className="control-panel-confirmation-actions">
              <button className="control-panel-action" type="button" onClick={closeSensitiveAction}>Cancel</button>
              <button
                className="control-panel-action primary"
                type="submit"
                disabled={!actionReason.trim() || busyOrganizationId === pendingSensitiveAction.organization.id}
              >
                {busyOrganizationId === pendingSensitiveAction.organization.id ? 'Saving…' : 'Confirm change'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </main>
  );
}
