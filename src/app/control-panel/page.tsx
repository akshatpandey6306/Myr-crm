'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { crmApiFetch } from '../../lib/api-client';
import { billingIntervalLabel } from '../../lib/billing-interval';
import { downloadCsv } from '../../lib/csv';
import PartnerManagementPanel from './PartnerManagementPanel';

type Organization = {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  memberCount: number;
  pendingMemberRequestCount: number;
  additionalSeats: number;
  additionalSeatRevenue: number;
  dealCount: number;
  openPipelineValue: number;
  wonRevenue: number;
  currency: string;
  createdAt: string;
  enabledModules: string[];
  owner: { name: string; email: string } | null;
  lastPayment?: {
    transactionId: string;
    paymentType: string;
    amount: string;
    currency: string;
    status: string;
    payuId: string | null;
    paidAt: string | null;
    createdAt: string;
  } | null;
  subscription: {
    planCode: string | null;
    status: 'pending' | 'active' | 'expired' | 'cancelled';
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
  billingInterval: number;
  features: string[];
  modules: string[];
  employeeLimit: number | null;
  additionalSeatsEnabled: boolean;
  additionalSeatPrice: number;
  maxDevicesPerUser: number;
  deviceRestrictionEnabled: boolean;
  usageLimits: Record<string, number>;
  isActive: boolean;
};
type SubscriptionActivationRequest = {
  id: string;
  planCode: string;
  requestType: 'activation';
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
export type ControlPanelSection = 'overview' | 'onboarding' | 'plans' | 'approvals' | 'provisioning' | 'workspaces' | 'partners' | 'security' | 'audit-log';
type PendingSensitiveAction =
  | { kind: 'access'; organization: Organization; status: 'active' | 'suspended' }
  | { kind: 'subscription'; organization: Organization; status: 'active' | 'expired' | 'cancelled' }
  | { kind: 'modules'; organization: Organization; modules: string[] };

const crmModules = [
  ['leads', 'Leads'],
  ['contacts', 'Contacts'],
  ['companies', 'Companies'],
  ['deals', 'Deals'],
  ['vendors', 'Vendors'],
  ['billing-invoicing', 'Billing & Invoicing'],
  ['activities', 'Activities'],
  ['team', 'Team'],
  ['automation', 'Automation'],
  ['email', 'Email'],
  ['reports', 'Reports'],
  ['audit-logs', 'Audit Logs'],
  ['settings', 'Settings'],
] as const;

const controlPanelSections: Array<{ id: ControlPanelSection; label: string; href: string; description: string }> = [
  { id: 'overview', label: 'Overview', href: '/control-panel', description: 'Platform activity and administration shortcuts.' },
  { id: 'workspaces', label: 'Workspaces', href: '/control-panel/workspaces', description: 'Search tenants, review account status, and manage workspace access.' },
  { id: 'approvals', label: 'Approvals', href: '/control-panel/approvals', description: 'Review pending signup and subscription requests.' },
  { id: 'provisioning', label: 'Provisioning', href: '/control-panel/provisioning', description: 'Monitor purchased CRM workspaces and retry activation email delivery.' },
  { id: 'partners', label: 'Partners', href: '/control-panel/partners', description: 'Manage server integrations, keys, provisioned customers, and webhook events.' },
  { id: 'onboarding', label: 'Onboard workspace', href: '/control-panel/onboarding', description: 'Create a workspace and its first Owner account.' },
  { id: 'plans', label: 'Subscription plans', href: '/control-panel/plans', description: 'Configure available plans, limits, and included modules.' },
  { id: 'security', label: 'Security & devices', href: '/control-panel/security', description: 'Configure login lockouts, sessions, device limits, and revoke active sessions.' },
  { id: 'audit-log', label: 'Audit log', href: '/control-panel/audit-log', description: 'Review and export recent platform administration actions.' },
];

const emptyPlan = {
  code: '',
  name: '',
  price: '0',
  currency: 'INR',
  billingInterval: '30',
  features: '',
  modules: ['leads', 'contacts', 'companies', 'deals', 'vendors', 'billing-invoicing', 'activities', 'team', 'settings'],
  employeeLimit: '',
  additionalSeatsEnabled: false,
  additionalSeatPrice: '0',
  maxDevicesPerUser: '1',
  deviceRestrictionEnabled: true,
  usageLimits: '{}',
  isActive: true,
};
type PlanFormState = typeof emptyPlan;
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
type SecurityConfiguration = {
  failedLoginLockoutEnabled: boolean;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  sessionLifetimeMinutes: number;
  deviceRestrictionsEnabled: boolean;
};
type SecuritySession = {
  id: string;
  userId: string;
  user: { name: string; email: string };
  organization: { id: string; name: string; subscriptionPlan: string | null } | null;
  deviceLabel: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};
const defaultSecurityConfiguration: SecurityConfiguration = {
  failedLoginLockoutEnabled: true,
  maxFailedLoginAttempts: 3,
  lockoutDurationMinutes: 10,
  sessionLifetimeMinutes: 10080,
  deviceRestrictionsEnabled: true,
};
type ProvisioningRequest = {
  id: string; requestId: string; orderId: string; product: string; status: string;
  organizationId: string | null; ownerUserId: string | null; planCode: string;
  failureCode: string | null; activationEmailSent: boolean; createdAt: string; updatedAt: string;
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
    ['pending', 'active', 'expired', 'cancelled'].includes((organization.subscription as Record<string, unknown>).status as string);
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.code === 'string' &&
    typeof plan.name === 'string' &&
    typeof plan.price === 'number' &&
    typeof plan.currency === 'string' &&
    Number.isSafeInteger(plan.billingInterval) && Number(plan.billingInterval) > 0 &&
    Array.isArray(plan.features) &&
    Array.isArray(plan.modules) &&
    plan.modules.every((module) => typeof module === 'string') &&
    (plan.employeeLimit === null || typeof plan.employeeLimit === 'number') &&
    typeof plan.maxDevicesPerUser === 'number' &&
    typeof plan.deviceRestrictionEnabled === 'boolean' &&
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

export default function ControlPanelPage({ section = 'overview' }: { section?: ControlPanelSection }) {
  const currentSection = controlPanelSections.find((item) => item.id === section) ?? controlPanelSections[0];
  const currentSectionIndex = controlPanelSections.findIndex((item) => item.id === section);
  const previousSection = currentSectionIndex > 0 ? controlPanelSections[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < controlPanelSections.length - 1 ? controlPanelSections[currentSectionIndex + 1] : null;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [activationRequests, setActivationRequests] = useState<SubscriptionActivationRequest[]>([]);
  const [provisioningRequests, setProvisioningRequests] = useState<ProvisioningRequest[]>([]);
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
  const [exportingAuditLogs, setExportingAuditLogs] = useState(false);
  const [auditExportMessage, setAuditExportMessage] = useState('');
  const [onboardingMessage, setOnboardingMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, WorkspaceMember[] | undefined>>({});
  const [memberDialogOrganization, setMemberDialogOrganization] = useState<Organization | null>(null);
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
  const [planApplyScope, setPlanApplyScope] = useState<'all' | 'organization'>('all');
  const [planTargetOrganizationId, setPlanTargetOrganizationId] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planMessage, setPlanMessage] = useState('');
  const [securityConfiguration, setSecurityConfiguration] = useState<SecurityConfiguration>(defaultSecurityConfiguration);
  const [securitySessions, setSecuritySessions] = useState<SecuritySession[]>([]);
  const [securityUsage, setSecurityUsage] = useState<Array<{ userId: string; user: { name: string; email: string }; organization: { id: string; name: string } | null; activeDevices: number; activeSessions: number; deviceLimit: number | null; overLimit: boolean }>>([]);
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [accessMessage, setAccessMessage] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<PendingSensitiveAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const actionDialogRef = useRef<HTMLDialogElement>(null);
  const memberDialogRef = useRef<HTMLDialogElement>(null);

  const activeSubscriptions = organizations.filter(({ subscription }) =>
    subscription.status === 'active').length;
  const attentionWorkspaces = organizations.filter(({ status, subscription }) =>
    status === 'suspended' || ['pending', 'expired', 'cancelled'].includes(subscription.status)).length;
  const recentOrganizations = [...organizations]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 5);
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
        ? organization.status === 'active' && organization.subscription.status === 'active'
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

  async function loadSecuritySettings(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/security-settings', signal ? { signal } : {});
      const payload = await response.json();
      if (!response.ok || !payload?.data?.settings || !Array.isArray(payload.data.sessions) || !Array.isArray(payload.data.usage)) {
        throw new Error(payload?.error?.message ?? 'Could not load security settings.');
      }
      setSecurityConfiguration(payload.data.settings as SecurityConfiguration);
      setSecuritySessions(payload.data.sessions as SecuritySession[]);
      setSecurityUsage(payload.data.usage);
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') setError(caught instanceof Error ? caught.message : 'Could not load security settings.');
    }
  }

  async function saveSecuritySettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSecurity(true);
    setError('');
    setAccessMessage('');
    try {
      const response = await crmApiFetch('/control-panel/security-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(securityConfiguration),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not save security settings.');
      setSecurityConfiguration(payload.data as SecurityConfiguration);
      setAccessMessage('Security configuration saved and audited.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save security settings.');
    } finally {
      setSavingSecurity(false);
    }
  }

  async function revokeAdminSession(session: SecuritySession) {
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/sessions/${encodeURIComponent(session.id)}/revoke`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not revoke this session.');
      await loadSecuritySettings();
      setAccessMessage(`Revoked ${session.deviceLabel} for ${session.user.email}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke this session.');
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
          (request as SubscriptionActivationRequest).requestType === 'activation' &&
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

  async function loadProvisioningRequests(signal?: AbortSignal) {
    try {
      const response = await crmApiFetch('/control-panel/provisioning-requests', signal ? { signal } : {});
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
        throw new Error('Could not load provisioning requests.');
      }
      setProvisioningRequests((payload as { data: ProvisioningRequest[] }).data);
    } catch (caught) {
      if (!(caught instanceof Error) || caught.name !== 'AbortError') setError(caught instanceof Error ? caught.message : 'Could not load provisioning requests.');
    } finally {
      setLoading(false);
    }
  }

  async function retryActivationEmail(item: ProvisioningRequest) {
    setBusyOrganizationId(item.id);
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/provisioning-requests/${encodeURIComponent(item.requestId)}/retry-activation-email`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not retry activation email.');
      await loadProvisioningRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not retry activation email.');
    } finally {
      setBusyOrganizationId('');
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
    setError('');
    if (section === 'overview') {
      setLoading(true);
      void loadOrganizations(controller.signal);
      void loadActivationRequests(controller.signal);
      void loadWorkspaceSignupRequests(controller.signal);
    } else if (section === 'onboarding' || section === 'plans') {
      void loadPlans(controller.signal);
    } else if (section === 'approvals') {
      void loadPlans(controller.signal);
      void loadActivationRequests(controller.signal);
      void loadWorkspaceSignupRequests(controller.signal);
    } else if (section === 'provisioning') {
      setLoading(true);
      void loadProvisioningRequests(controller.signal);
    } else if (section === 'workspaces') {
      setLoading(true);
      void loadOrganizations(controller.signal);
      void loadPlans(controller.signal);
    } else if (section === 'audit-log') {
      void loadAuditLogs();
    } else if (section === 'security') {
      setLoading(true);
      void loadSecuritySettings(controller.signal).finally(() => setLoading(false));
    }
    return () => controller.abort();
  }, [section]);
  useEffect(() => {
    const query = search.trim();
    if (section !== 'workspaces' || !query) {
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
  }, [search, section]);
  useEffect(() => {
    const dialog = actionDialogRef.current;
    if (pendingSensitiveAction && dialog && !dialog.open) dialog.showModal();
  }, [pendingSensitiveAction]);
  useEffect(() => {
    const dialog = memberDialogRef.current;
    if (memberDialogOrganization && dialog && !dialog.open) dialog.showModal();
    if (!memberDialogOrganization && dialog?.open) dialog.close();
  }, [memberDialogOrganization]);

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
      const result = typeof payload === 'object' && payload !== null && 'data' in payload
        ? (payload as { data?: { alreadyActive?: boolean } }).data
        : undefined;
      setAccessMessage(result?.alreadyActive
        ? `Cleared the pending request for ${subscriptionRequest.organization.name}; this workspace is already active on ${subscriptionRequest.planCode}.`
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
      const data = typeof payload === 'object' && payload !== null && 'data' in payload ? (payload as { data?: { name?: string; welcomeEmailSent?: boolean; owner?: { email?: string } } }).data : undefined;
      setOnboardingMessage(data?.welcomeEmailSent
        ? `Created ${data.name ?? 'workspace'} for ${data.owner?.email ?? onboarding.ownerEmail}. Welcome email with sign-in link and credentials sent.`
        : `Created ${data?.name ?? 'workspace'} for ${data?.owner?.email ?? onboarding.ownerEmail}, but the welcome email could not be sent. Check SMTP settings.`);
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
        billingInterval: Number(planDraft.billingInterval),
        features: planDraft.features.split('\n').map((feature) => feature.trim()).filter(Boolean),
        modules: planDraft.modules,
        employeeLimit: planDraft.employeeLimit === '' ? null : Number(planDraft.employeeLimit),
        additionalSeatsEnabled: planDraft.additionalSeatsEnabled,
        additionalSeatPrice: Number(planDraft.additionalSeatPrice),
        maxDevicesPerUser: Number(planDraft.maxDevicesPerUser),
        deviceRestrictionEnabled: planDraft.deviceRestrictionEnabled,
        usageLimits,
        isActive: planDraft.isActive,
        applyTo: planApplyScope,
        ...(planApplyScope === 'organization' ? { organizationId: planTargetOrganizationId } : {}),
      };
      if (editingPlanCode && planApplyScope === 'organization' && !planTargetOrganizationId) {
        throw new Error('Choose the workspace that should receive this plan change.');
      }
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
      const targetName = organizations.find(({ id }) => id === planTargetOrganizationId)?.name;
      setPlanMessage(editingPlanCode
        ? planApplyScope === 'organization' ? `${planDraft.name} updated for ${targetName ?? 'the selected workspace'} only.` : `${planDraft.name} updated for all workspaces using this plan.`
        : `${planDraft.name} created and available to all workspaces.`);
      setPlanDraft(emptyPlan);
      setEditingPlanCode('');
      setPlanApplyScope('all');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save subscription plan.');
    } finally {
      setSavingPlan(false);
    }
  }

  async function editPlan(plan: SubscriptionPlan) {
    let effectivePlan = plan;
    if (planApplyScope === 'organization' && !planTargetOrganizationId) {
      setError('Choose a workspace before editing a workspace-specific plan.');
      return;
    }
    if (planApplyScope === 'organization') {
      try {
        const response = await crmApiFetch(`/control-panel/plans/${encodeURIComponent(plan.code)}?organizationId=${encodeURIComponent(planTargetOrganizationId)}`);
        const payload: unknown = await response.json();
        const value = typeof payload === 'object' && payload !== null && 'data' in payload ? (payload as { data?: unknown }).data : null;
        if (!response.ok || typeof value !== 'object' || value === null) throw new Error('Could not load this workspace’s plan settings.');
        const record = value as Record<string, unknown>;
        effectivePlan = {
          ...plan,
          name: typeof record.name === 'string' ? record.name : plan.name,
          price: typeof record.price === 'number' ? record.price : plan.price,
          currency: typeof record.currency === 'string' ? record.currency.trim() : plan.currency,
          billingInterval: Number(record.billingInterval) || plan.billingInterval,
          features: Array.isArray(record.features) ? record.features as string[] : plan.features,
          modules: Array.isArray(record.modules) ? record.modules as string[] : plan.modules,
          employeeLimit: typeof record.employeeLimit === 'number' ? record.employeeLimit : null,
          additionalSeatsEnabled: typeof record.additionalSeatsEnabled === 'boolean' ? record.additionalSeatsEnabled : plan.additionalSeatsEnabled,
          additionalSeatPrice: typeof record.additionalSeatPrice === 'number' ? record.additionalSeatPrice : plan.additionalSeatPrice,
          maxDevicesPerUser: typeof record.maxDevicesPerUser === 'number' ? record.maxDevicesPerUser : plan.maxDevicesPerUser,
          deviceRestrictionEnabled: typeof record.deviceRestrictionEnabled === 'boolean' ? record.deviceRestrictionEnabled : plan.deviceRestrictionEnabled,
          usageLimits: typeof record.usageLimits === 'object' && record.usageLimits !== null ? record.usageLimits as Record<string, number> : plan.usageLimits,
          isActive: typeof record.isActive === 'boolean' ? record.isActive : plan.isActive,
        };
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load this workspace’s plan settings.');
        return;
      }
    }
    setEditingPlanCode(plan.code);
    setPlanDraft({
      code: effectivePlan.code,
      name: effectivePlan.name,
      price: String(effectivePlan.price),
      currency: effectivePlan.currency,
      billingInterval: String(effectivePlan.billingInterval),
      features: effectivePlan.features.join('\n'),
      modules: effectivePlan.modules,
      employeeLimit: effectivePlan.employeeLimit === null ? '' : String(effectivePlan.employeeLimit),
      additionalSeatsEnabled: effectivePlan.additionalSeatsEnabled,
      additionalSeatPrice: String(effectivePlan.additionalSeatPrice),
      maxDevicesPerUser: String(effectivePlan.maxDevicesPerUser),
      deviceRestrictionEnabled: effectivePlan.deviceRestrictionEnabled,
      usageLimits: JSON.stringify(effectivePlan.usageLimits, null, 2),
      isActive: effectivePlan.isActive,
    });
    setPlanMessage('');
  }

  async function togglePlanActive(plan: SubscriptionPlan) {
    const action = plan.isActive ? 'deactivate' : 'activate';
    if (planApplyScope === 'organization' && !planTargetOrganizationId) {
      setError('Choose a workspace before changing this plan for one workspace.');
      return;
    }
    const targetName = organizations.find(({ id }) => id === planTargetOrganizationId)?.name;
    const scopeText = planApplyScope === 'organization' ? ` for ${targetName ?? 'the selected workspace'} only` : ' for all workspaces';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} the ${plan.name} plan${scopeText}?`)) return;
    setError('');
    try {
      const response = await crmApiFetch(`/control-panel/plans/${encodeURIComponent(plan.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: !plan.isActive,
          applyTo: planApplyScope,
          ...(planApplyScope === 'organization' ? { organizationId: planTargetOrganizationId } : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload ? (payload as { error?: { message?: string } }).error : undefined;
        throw new Error(apiError?.message ?? `Could not ${action} plan.`);
      }
      await loadPlans();
      setPlanMessage(`${plan.name} ${action}d${scopeText}.`);
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

  async function exportAuditLogs() {
    setExportingAuditLogs(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (auditActionFilter !== 'all') params.set('action', auditActionFilter);
      const response = await crmApiFetch(`/control-panel/audit-logs/export${params.size ? `?${params}` : ''}`);
      const payload: unknown = await response.json();
      if (!response.ok || typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
        const apiError = typeof payload === 'object' && payload !== null && 'error' in payload
          ? (payload as { error?: { message?: string } }).error
          : undefined;
        throw new Error(apiError?.message ?? 'Could not export the platform audit log.');
      }
      const exportRows = (payload as { data: {
        createdAt: string;
        actorName: string | null;
        actorEmail: string | null;
        action: string;
        targetType: string;
        targetId: string | null;
        reason: string | null;
        details: unknown;
      }[] }).data;
      const filteredRows = exportRows.filter((log) => !normalizedAuditSearch || [
        log.action,
        log.targetType,
        log.targetId,
        log.actorName,
        log.actorEmail,
        log.reason,
        JSON.stringify(log.details),
      ].some((value) => value?.toLowerCase().includes(normalizedAuditSearch)));
      downloadCsv('platform-audit-log.csv',
        ['timestamp', 'actor_name', 'actor_email', 'action', 'target_type', 'target_id', 'reason', 'details'],
        filteredRows.map((log) => [
          log.createdAt,
          log.actorName ?? '',
          log.actorEmail ?? '',
          log.action,
          log.targetType,
          log.targetId ?? '',
          log.reason ?? '',
          JSON.stringify(log.details ?? ''),
        ]));
      setAuditExportMessage(`Exported ${filteredRows.length} platform audit entries.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export the platform audit log.');
    } finally {
      setExportingAuditLogs(false);
    }
  }



  async function toggleMembers(organization: Organization) {
    setMemberDialogOrganization(organization);
    if (expandedMembers[organization.id] !== undefined || loadingMembers[organization.id]) return;
    setExpandedMembers((current) => ({ ...current, [organization.id]: [] }));
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
        <div className="brand" aria-label="LeadPilot platform administration">
          <img className="brand-partner-logo" src="/leadpilot-advance-solution.svg" alt="LeadPilot by Advance Solution" />
        </div>
        <div className="control-panel-header-actions">
          <span className="control-panel-live"><i /> Admin console</span>
        <button suppressHydrationWarning className="control-panel-signout" type="button" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        </div>
      </header>
      <div className="control-panel-content">
        <div className="control-panel-title-row">
          <div>
            <p className="date-label">INTERNAL ADMINISTRATION</p>
            <h1>{currentSection.label}</h1>
            <p className="control-panel-intro">{currentSection.description}</p>
          </div>
          <div className="control-panel-title-actions">
            <button suppressHydrationWarning className="control-panel-action" type="button" disabled={refreshing || loading} onClick={() => section === 'provisioning' ? void loadProvisioningRequests() : void refreshOrganizations()}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="control-panel-error" role="alert">
            {error}
            {error.startsWith('Sign in') && <> <Link href="/sign-in">Sign in</Link></>}
          </div>
        )}
        {accessMessage && <p className="control-panel-success control-panel-access-message" role="status">{accessMessage}</p>}

        <div className="control-panel-layout">
        <nav className="control-panel-nav" aria-label="Control panel sections">
          <span className="control-panel-nav-heading">SECTIONS</span>
          {controlPanelSections.map((item) => (
            <Link key={item.id} href={item.href} aria-current={item.id === section ? 'page' : undefined} title={item.description}>
              <span>{item.label}</span><span className="control-panel-nav-arrow" aria-hidden="true">›</span>
            </Link>
          ))}
        </nav>
        <div className="control-panel-main">
        {section === 'overview' && <>
        <section className="control-panel-metrics" aria-label="Platform summary">
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
        <section className="control-panel-overview-grid" aria-label="Workspace and subscription overview">
          <article className="control-panel-overview-card control-panel-health-card">
            <div className="control-panel-overview-card-heading">
              <div><p className="control-panel-overview-eyebrow">PORTFOLIO HEALTH</p><h2>Subscription status</h2></div>
              <Link href="/control-panel/workspaces">Manage workspaces <span aria-hidden="true">↗</span></Link>
            </div>
            <div className="control-panel-health-total"><strong>{loading ? '—' : organizations.length}</strong><span>workspaces tracked</span></div>
            <div className="control-panel-health-bar" role="img" aria-label={`${activeSubscriptions} active, ${attentionWorkspaces} needing attention`}>
              <span className="active" style={{ width: `${organizations.length ? activeSubscriptions / organizations.length * 100 : 0}%` }} />
              <span className="attention" style={{ width: `${organizations.length ? attentionWorkspaces / organizations.length * 100 : 0}%` }} />
            </div>
            <div className="control-panel-health-legend">
              <div><i className="active" /><span>Active</span><strong>{loading ? '—' : activeSubscriptions}</strong></div>
              <div><i className="attention" /><span>Needs attention</span><strong>{loading ? '—' : attentionWorkspaces}</strong></div>
            </div>
            <div className="control-panel-overview-actions">
              <Link href="/control-panel/approvals">Review requests <span aria-hidden="true">→</span></Link>
              <Link href="/control-panel/plans">Manage plans <span aria-hidden="true">→</span></Link>
              <Link href="/control-panel/security">Security &amp; devices <span aria-hidden="true">→</span></Link>
            </div>
          </article>
          <article className="control-panel-overview-card control-panel-recent-card">
            <div className="control-panel-overview-card-heading">
              <div><p className="control-panel-overview-eyebrow">LATEST ACTIVITY</p><h2>Recently created workspaces</h2></div>
              <Link href="/control-panel/workspaces">View all <span aria-hidden="true">↗</span></Link>
            </div>
            {loading ? <p className="control-panel-overview-empty">Loading workspace activity…</p> : recentOrganizations.length ? (
              <ul className="control-panel-recent-list">
                {recentOrganizations.map((organization) => (
                  <li key={organization.id}>
                    <span className="control-panel-recent-avatar" aria-hidden="true">{organization.name.trim().charAt(0).toUpperCase() || 'W'}</span>
                    <span className="control-panel-recent-copy"><strong>{organization.name}</strong><small>{organization.owner?.email ?? 'No owner email'}</small></span>
                    <span className={`control-panel-status ${organization.subscription.status}`}>{organization.subscription.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="control-panel-overview-empty-state">
                <span aria-hidden="true">✦</span>
                <strong>Your workspace portfolio starts here</strong>
                <p>Create the first workspace or review your platform setup.</p>
                <Link className="control-panel-action primary" href="/control-panel/onboarding">Onboard a workspace <span aria-hidden="true">→</span></Link>
              </div>
            )}
          </article>
        </section>
        </>}

        {section === 'approvals' && <div className="control-panel-section-stack">
        <section id="workspace-signups" className="panel control-panel-table" aria-label="Workspace signup approvals">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Legacy workspace signup approvals</h2>
              <p>{workspaceSignupRequests.length} older signups awaiting platform-admin review</p>
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
              <p>{activationRequests.length} plan requests awaiting review</p>
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
                    <td>Plan activation</td>
                    <td>{subscriptionPlans.find((plan) => plan.code === activationRequest.planCode)?.name ?? activationRequest.planCode}</td>
                    <td>{new Date(activationRequest.requestedAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="control-panel-action primary"
                        type="button"
                        disabled={Boolean(busyOrganizationId)}
                        onClick={() => void reviewSubscriptionRequest(activationRequest, 'approve')}
                      >
                        Activate manually
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
          ) : <p className="control-panel-empty">No plan requests are waiting.</p>}
        </section>
        </div>}

        {section === 'provisioning' && <section className="panel control-panel-table" aria-label="CRM provisioning requests">
          <div className="panel-heading"><div className="control-panel-section-title"><h2>Provisioning requests</h2><p>{provisioningRequests.length} recent central-commerce CRM requests</p></div></div>
          {provisioningRequests.length ? <div className="table-scroll"><table>
            <thead><tr><th>REQUEST / ORDER</th><th>WORKSPACE</th><th>PLAN</th><th>STATUS</th><th>ACTIVATION EMAIL</th><th>CREATED</th><th>ACTION</th></tr></thead>
            <tbody>{provisioningRequests.map((item) => <tr key={item.id}>
              <td><strong>{item.requestId}</strong><small>{item.orderId}</small></td>
              <td>{item.organizationId ?? '—'}<small>{item.product.toUpperCase()}</small></td>
              <td>{item.planCode}</td>
              <td><span className={`control-panel-status ${item.status === 'SUCCEEDED' ? 'active' : item.status === 'FAILED' ? 'cancelled' : 'pending'}`}>{item.status}</span>{item.failureCode && <small>{item.failureCode}</small>}</td>
              <td>{item.activationEmailSent ? 'Sent' : 'Needs retry'}</td>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
              <td>{!item.activationEmailSent && item.status === 'SUCCEEDED' ? <button className="control-panel-action" type="button" disabled={Boolean(busyOrganizationId)} onClick={() => void retryActivationEmail(item)}>{busyOrganizationId === item.id ? 'Sending…' : 'Retry email'}</button> : '—'}</td>
            </tr>)}</tbody>
          </table></div> : <p className="control-panel-empty">No provisioning requests yet.</p>}
        </section>}
        {section === 'partners' && <PartnerManagementPanel />}

        {section === 'onboarding' && <>
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
                    {plan.name} · {billingIntervalLabel(plan.billingInterval)}
                  </option>
                ))}
              </select>
            </label>
            <button suppressHydrationWarning className="control-panel-action primary" type="submit" disabled={onboardingBusy}>{onboardingBusy ? 'Creating…' : 'Create workspace'}</button>
          </form>
        </section>
        </>}

        {section === 'plans' && <>
        <section id="plans" className="panel control-panel-plan-management" aria-label="Subscription plans">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Subscription plans</h2>
            </div>
            <div className="control-panel-plan-scope">
              <label>Plan edit scope<select disabled={Boolean(editingPlanCode)} value={planApplyScope} onChange={(event) => setPlanApplyScope(event.target.value as 'all' | 'organization')}><option value="all">All workspaces</option><option value="organization">One workspace</option></select></label>
              {planApplyScope === 'organization' && <label>Workspace<select disabled={Boolean(editingPlanCode)} value={planTargetOrganizationId} onChange={(event) => setPlanTargetOrganizationId(event.target.value)}><option value="">Choose a workspace</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
            </div>
          </div>
          {planMessage && <p className="control-panel-success" role="status">{planMessage}</p>}
          <div className="table-scroll control-panel-plan-table">
            <table>
              <thead><tr><th>PLAN</th><th>PRICE</th><th>INTERVAL</th><th>EMPLOYEES</th><th>DEVICES / USER</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
              <tbody>
                {subscriptionPlans.map((plan) => (
                  <tr key={plan.code}>
                    <td><strong>{plan.name}</strong><small>{plan.code}</small></td>
                    <td>{plan.currency} {plan.price.toLocaleString()}</td>
                    <td>{billingIntervalLabel(plan.billingInterval)}</td>
                    <td>{plan.employeeLimit ?? 'Unlimited'}</td>
                    <td>{plan.deviceRestrictionEnabled ? plan.maxDevicesPerUser : 'Unlimited'}</td>
                    <td><span className={`control-panel-status ${plan.isActive ? 'active' : 'cancelled'}`}>{plan.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div className="control-panel-plan-actions">
                        <button className="control-panel-action" type="button" onClick={() => void editPlan(plan)}>Edit</button>
                        {planApplyScope === 'all' && <button className="control-panel-action" type="button" onClick={() => void togglePlanActive(plan)}>{plan.isActive ? 'Deactivate' : 'Activate'}</button>}
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
            {!editingPlanCode && <p>New plans are shared with all workspaces. Choose an edit scope above to customize an existing plan.</p>}
            <label>Plan code<input value={planDraft.code} disabled={Boolean(editingPlanCode)} required pattern="[a-z0-9][a-z0-9-]{1,31}" onChange={(event) => setPlanDraft((current) => ({ ...current, code: event.target.value.toLowerCase() }))} placeholder="team-30-days" /></label>
            <label>Plan name<input value={planDraft.name} required maxLength={80} onChange={(event) => setPlanDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Team Monthly" /></label>
            <label>Price (whole units)<input type="number" min="0" step="1" value={planDraft.price} required onChange={(event) => setPlanDraft((current) => ({ ...current, price: event.target.value }))} /></label>
            <label>Currency<input value={planDraft.currency} required maxLength={3} onChange={(event) => setPlanDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></label>
            <label>Plan duration (days)<input type="number" min="1" max="3650" step="1" value={planDraft.billingInterval} onChange={(event) => setPlanDraft((current) => ({ ...current, billingInterval: event.target.value }))} required /></label>
            <label>Employee limit<input type="number" min="1" step="1" value={planDraft.employeeLimit} onChange={(event) => setPlanDraft((current) => ({ ...current, employeeLimit: event.target.value }))} placeholder="Blank means unlimited" /></label>
            <label>Additional seat price per seat / plan period<input type="number" min="0" step="1" value={planDraft.additionalSeatPrice} onChange={(event) => setPlanDraft((current) => ({ ...current, additionalSeatPrice: event.target.value }))} disabled={!planDraft.additionalSeatsEnabled} /></label>
            <label className="control-panel-checkbox"><input type="checkbox" checked={planDraft.additionalSeatsEnabled} onChange={(event) => setPlanDraft((current) => ({ ...current, additionalSeatsEnabled: event.target.checked }))} /> Allow paid additional seats</label>
            <label>Maximum simultaneous devices per user<input type="number" min="1" max="100" step="1" value={planDraft.maxDevicesPerUser} onChange={(event) => setPlanDraft((current) => ({ ...current, maxDevicesPerUser: event.target.value }))} /></label>
            <label className="control-panel-checkbox"><input type="checkbox" checked={planDraft.deviceRestrictionEnabled} onChange={(event) => setPlanDraft((current) => ({ ...current, deviceRestrictionEnabled: event.target.checked }))} /> Enforce this device limit for the plan</label>
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
              {editingPlanCode && <button className="control-panel-action" type="button" onClick={() => { setEditingPlanCode(''); setPlanDraft(emptyPlan); setPlanApplyScope('all'); }}>Cancel edit</button>}
            </div>
          </form>
        </section>
        </>}

        {section === 'workspaces' && <>
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
              <table className="control-panel-workspace-list">
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
                    const hasActiveSubscription = organization.subscription.status === 'active';
                    const activeDefault = subscriptionPlans.find((plan) => plan.isActive)?.code ?? '';
                    const currentPlanAvailable = subscriptionPlans.some((plan) => plan.code === organization.subscription.planCode && plan.isActive);
                    const selectedPlan = selectedPlans[organization.id] ?? (currentPlanAvailable ? organization.subscription.planCode : activeDefault) ?? '';
                    const selectedPlanRecord = subscriptionPlans.find((plan) => plan.code === selectedPlan);
                    const tenantPlan = subscriptionPlans.find((plan) => plan.code === organization.subscription.planCode);
                    const seatLimit = tenantPlan?.employeeLimit;
                    const totalSeatLimit = seatLimit === null || seatLimit === undefined ? null : seatLimit + organization.additionalSeats;
                    const seatsUsed = organization.memberCount + organization.pendingMemberRequestCount;
                    const seatLimitStatus = totalSeatLimit === null
                      ? null
                      : seatsUsed > totalSeatLimit ? 'over' : seatsUsed === totalSeatLimit ? 'at' : null;
                    const currentPlanName = selectedPlanRecord?.name ?? selectedPlan;
                    return (
                    <Fragment key={organization.id}>
                    <tr>
                      <td>
                        <div className="control-panel-workspace"><span className="control-panel-workspace-avatar">{organization.name.slice(0, 1).toUpperCase()}</span><strong>{organization.name}</strong></div>
                        <small className="control-panel-revenue-summary">
                          {organization.dealCount} deals · {organization.currency} {organization.wonRevenue.toLocaleString()} won · {organization.currency} {organization.openPipelineValue.toLocaleString()} open
                        </small>
                        <button className="control-panel-action control-panel-module-toggle" type="button" aria-controls={`workspace-modules-${organization.id}`} aria-expanded={Boolean(expandedModules[organization.id])} disabled={busyOrganizationId === organization.id} onClick={() => setExpandedModules((current) => ({ ...current, [organization.id]: !current[organization.id] }))}>
                          {expandedModules[organization.id] ? 'Close module access' : `Choose workspace modules (${organization.enabledModules.length})`}
                        </button>
                      </td>
                      <td>{organization.owner ? <div className="control-panel-owner"><strong>{organization.owner.name}</strong><span>{organization.owner.email}</span></div> : '—'}</td>
                      <td>
                        <div className={`control-panel-seat-usage${seatLimitStatus ? ' at-limit' : ''}`}>
                          <button
                            suppressHydrationWarning
                            className="control-panel-member-count control-panel-member-toggle"
                            type="button"
                            onClick={() => void toggleMembers(organization)}
                            aria-expanded={memberDialogOrganization?.id === organization.id}
                            aria-label={`View ${organization.memberCount} active members for ${organization.name}`}
                          >
                            {organization.memberCount} active {memberDialogOrganization?.id === organization.id ? '▲' : '▼'}
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
                                : `${seatsUsed} / ${totalSeatLimit} seats`
                              : organization.subscription.planCode
                                ? `${seatsUsed} seats · plan limit unavailable`
                                : `${seatsUsed} seats · no plan assigned`}
                          </small>
                          {organization.additionalSeats > 0 && <small>{organization.additionalSeats} paid extra seat{organization.additionalSeats === 1 ? '' : 's'} · {tenantPlan?.currency ?? 'INR'} {organization.additionalSeatRevenue.toLocaleString('en-IN')} received</small>}
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
                          {organization.lastPayment && <small className={`control-panel-payment-status ${organization.lastPayment.status}`} title={organization.lastPayment.payuId ? `PayU payment ${organization.lastPayment.payuId}` : `Transaction ${organization.lastPayment.transactionId}`}>
                            {organization.lastPayment.status === 'succeeded' ? 'Payment verified' : organization.lastPayment.status === 'failed' ? 'Payment failed' : 'Payment pending'} · {organization.lastPayment.currency} {Number(organization.lastPayment.amount).toLocaleString('en-IN')} · {new Date(organization.lastPayment.paidAt ?? organization.lastPayment.createdAt).toLocaleDateString()}
                          </small>}
                        </div>
                      </td>
                      <td>{organization.subscription.endsAt ? new Date(organization.subscription.endsAt).toLocaleDateString() : '—'}</td>
                      <td><div className="control-panel-actions-cell">
                          <select aria-label={`Plan for ${organization.name}`} id={`plan-${organization.id}`} value={selectedPlan} disabled={busyOrganizationId === organization.id} onChange={(event) => setSelectedPlans((plans) => ({ ...plans, [organization.id]: event.target.value }))}>
                            {organization.subscription.planCode && !subscriptionPlans.some((plan) => plan.code === organization.subscription.planCode) && (
                              <option value={organization.subscription.planCode} disabled>{organization.subscription.planCode} (unavailable)</option>
                            )}
                            {subscriptionPlans.filter((plan) => plan.isActive).map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {billingIntervalLabel(plan.billingInterval)}</option>)}
                          </select>
                          <input aria-label={`Optional access end date for ${organization.name}`} className="control-panel-end-date" id={`access-end-${organization.id}`} type="date" value={accessEndDates[organization.id] ?? ''} disabled={busyOrganizationId === organization.id} onChange={(event) => setAccessEndDates((dates) => ({ ...dates, [organization.id]: event.target.value }))} />
                          <button suppressHydrationWarning className="control-panel-action primary" type="button" disabled={busyOrganizationId === organization.id || !subscriptionPlans.some((plan) => plan.isActive)} onClick={() => requestSubscriptionStatus(organization, 'active')}>
                            {busyOrganizationId === organization.id
                              ? 'Saving…'
                              : hasActiveSubscription && selectedPlan === organization.subscription.planCode
                                ? `Extend ${selectedPlanRecord ? billingIntervalLabel(selectedPlanRecord.billingInterval) : 'plan'}`
                                : hasActiveSubscription
                                  ? `Change to ${currentPlanName}`
                                : organization.subscription.status === 'expired'
                                  ? `Reactivate ${currentPlanName}`
                                  : `Activate ${currentPlanName}`}
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
                     {expandedModules[organization.id] && typeof document !== 'undefined' && createPortal(
                       <div id={`workspace-modules-${organization.id}`} className="control-panel-module-dialog-overlay" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setExpandedModules((current) => ({ ...current, [organization.id]: false })); }} onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedModules((current) => ({ ...current, [organization.id]: false })); }}>
                           <div className="control-panel-module-dialog" role="dialog" aria-modal="true" aria-label={`Module access for ${organization.name}`}>
                           <div className="control-panel-module-editor">
                             <div className="control-panel-module-editor-heading">
                               <div>
                               <strong>Enabled CRM modules</strong>
                               <p>
                                 Changes take effect immediately for this tenant’s users and API access.
                               </p>
                               </div>
                               <button className="control-panel-module-editor-close" type="button" aria-label="Close module access" onClick={() => setExpandedModules((current) => ({ ...current, [organization.id]: false }))}>×</button>
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
                           </div>
                       </div>,
                       document.body,
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
        </>}
        {section === 'security' && <>
        <section className="panel control-panel-plan-management" aria-label="Global security settings">
          <div className="panel-heading"><div className="control-panel-section-title"><h2>Authentication and session policy</h2><p>Changes are enforced by the API immediately and recorded in the platform audit log.</p></div></div>
          <form className="control-panel-plan-form control-panel-onboarding-form" onSubmit={(event) => void saveSecuritySettings(event)}>
            <label className="control-panel-checkbox"><input type="checkbox" checked={securityConfiguration.failedLoginLockoutEnabled} onChange={(event) => setSecurityConfiguration((current) => ({ ...current, failedLoginLockoutEnabled: event.target.checked }))} /> Enable temporary login lockout</label>
            <label>Failed attempts before lockout<input type="number" min="1" max="10" value={securityConfiguration.maxFailedLoginAttempts} onChange={(event) => setSecurityConfiguration((current) => ({ ...current, maxFailedLoginAttempts: Number(event.target.value) }))} /></label>
            <label>Lockout duration in minutes<input type="number" min="1" max="1440" value={securityConfiguration.lockoutDurationMinutes} onChange={(event) => setSecurityConfiguration((current) => ({ ...current, lockoutDurationMinutes: Number(event.target.value) }))} /></label>
            <label>Session lifetime in minutes<input type="number" min="5" max="43200" value={securityConfiguration.sessionLifetimeMinutes} onChange={(event) => setSecurityConfiguration((current) => ({ ...current, sessionLifetimeMinutes: Number(event.target.value) }))} /></label>
            <label className="control-panel-checkbox"><input type="checkbox" checked={securityConfiguration.deviceRestrictionsEnabled} onChange={(event) => setSecurityConfiguration((current) => ({ ...current, deviceRestrictionsEnabled: event.target.checked }))} /> Enable plan device restrictions globally</label>
            <button className="control-panel-action primary" type="submit" disabled={savingSecurity}>{savingSecurity ? 'Saving…' : 'Save security settings'}</button>
          </form>
        </section>

        <section className="panel control-panel-table" aria-label="Device usage by user">
          <div className="panel-heading"><div className="control-panel-section-title"><h2>Active device usage</h2><p>Limits apply per user. Existing sessions are retained after a limit is reduced; new devices are blocked until usage is within policy.</p></div></div>
          <div className="table-scroll control-panel-security-usage-table"><table><thead><tr><th>USER</th><th>WORKSPACE</th><th>ACTIVE DEVICES</th><th>ACTIVE SESSIONS</th><th>PLAN LIMIT</th><th>STATUS</th></tr></thead><tbody>
            {securityUsage.map((usage) => <tr key={usage.userId}><td>{usage.user.name}<small>{usage.user.email}</small></td><td>{usage.organization?.name ?? 'Platform account'}</td><td>{usage.activeDevices}</td><td>{usage.activeSessions}</td><td>{usage.deviceLimit ?? 'Not configured'}</td><td>{usage.overLimit ? <span className="control-panel-status cancelled">Over limit</span> : <span className="control-panel-status active">Within limit</span>}</td></tr>)}
            {securityUsage.length === 0 && <tr><td colSpan={6} className="control-panel-empty">No active sessions found.</td></tr>}
          </tbody></table></div>
        </section>

        <section className="panel control-panel-table" aria-label="Active sessions">
          <div className="panel-heading"><div className="control-panel-section-title"><h2>Active sessions</h2><p>Up to 500 non-expired sessions. Revocation is immediate and audited.</p></div><button className="control-panel-action" type="button" onClick={() => void loadSecuritySettings()}>Refresh sessions</button></div>
          <div className="table-scroll control-panel-security-sessions-table"><table><thead><tr><th>USER</th><th>DEVICE</th><th>WORKSPACE</th><th>LAST ACTIVE</th><th>EXPIRES</th><th>ACTION</th></tr></thead><tbody>
            {securitySessions.map((session) => <tr key={session.id}><td>{session.user.name}<small>{session.user.email}</small></td><td>{session.deviceLabel}<small>{session.userAgent ?? 'User agent unavailable'}</small></td><td>{session.organization?.name ?? 'Platform account'}</td><td>{new Date(session.lastSeenAt).toLocaleString()}</td><td>{new Date(session.expiresAt).toLocaleString()}</td><td><button className="control-panel-action" type="button" onClick={() => void revokeAdminSession(session)}>Revoke</button></td></tr>)}
            {securitySessions.length === 0 && <tr><td colSpan={6} className="control-panel-empty">No active sessions found.</td></tr>}
          </tbody></table></div>
        </section>
        </>}

        {section === 'audit-log' && <>
        <section id="audit-log" className="panel control-panel-audit" aria-label="Audit log">
          <div className="panel-heading">
            <div className="control-panel-section-title">
              <h2>Audit log</h2>
              <p>Showing the latest 50 platform administrator actions. Older entries are not included here.</p>
            </div>
            <div className="control-panel-audit-actions">
              <button suppressHydrationWarning className="control-panel-action" type="button" disabled={loadingAuditLogs} onClick={() => void loadAuditLogs()}>
                {loadingAuditLogs ? 'Loading…' : 'Load audit log'}
              </button>
              <button suppressHydrationWarning className="control-panel-action" type="button" disabled={exportingAuditLogs} onClick={() => void exportAuditLogs()}>
                {exportingAuditLogs ? 'Exporting…' : 'Export filtered CSV'}
              </button>
            </div>
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
          {auditExportMessage && <p className="control-panel-empty" role="status">{auditExportMessage}</p>}
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
        </>}

        <p className="control-panel-note">Plan and access changes are manual unless an existing billing provider records a payment. Suspended workspaces remain blocked until restored. Tenant member details are limited to account and role information.</p>
        </div>
        </div>
      </div>
      {memberDialogOrganization && (
        <dialog
          ref={memberDialogRef}
          className="control-panel-member-dialog"
          aria-labelledby="workspace-members-title"
          onCancel={(event) => {
            event.preventDefault();
            setMemberDialogOrganization(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setMemberDialogOrganization(null);
          }}
        >
          <header className="control-panel-member-dialog-header">
            <div>
              <p className="control-panel-confirmation-eyebrow">WORKSPACE MEMBERS</p>
              <h2 id="workspace-members-title">{memberDialogOrganization.name}</h2>
              <p>{memberDialogOrganization.memberCount} active member{memberDialogOrganization.memberCount === 1 ? '' : 's'}</p>
            </div>
            <button className="control-panel-member-dialog-close" type="button" aria-label="Close members" onClick={() => setMemberDialogOrganization(null)}>×</button>
          </header>
          <div className="control-panel-member-dialog-body">
            {loadingMembers[memberDialogOrganization.id] ? (
              <p className="control-panel-empty" role="status">Loading workspace members…</p>
            ) : memberErrors[memberDialogOrganization.id] ? (
              <div><p className="control-panel-error" role="alert">{memberErrors[memberDialogOrganization.id]}</p><button className="control-panel-action" type="button" onClick={() => { setExpandedMembers((current) => ({ ...current, [memberDialogOrganization.id]: undefined })); void toggleMembers(memberDialogOrganization); }}>Try again</button></div>
            ) : expandedMembers[memberDialogOrganization.id]?.length ? (
              <ul className="control-panel-member-cards">
                {expandedMembers[memberDialogOrganization.id]?.map((member) => (
                  <li key={member.id}>
                    <span className="control-panel-member-avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || '?'}</span>
                    <span className="control-panel-member-info"><strong>{member.name}</strong><span>{member.email}</span></span>
                    <span className="control-panel-status active">{member.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="control-panel-empty">No active members were returned for this workspace.</p>
            )}
          </div>
        </dialog>
      )}
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
