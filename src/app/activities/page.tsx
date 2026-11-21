"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  apiErrorMessage,
  loadRelatedRecordOptions,
} from "./activity-api";
import type { RelatedRecordOption, RelatedRecordType } from "./activity-api";
import { crmApiFetch } from "../../lib/api-client";
import NightingaleChart from "../components/NightingaleChart";
import type { DistributionDatum } from "../components/chart-types";

type ActivityType = "task" | "call" | "meeting" | "note" | "email";
type ActivityStatus = "open" | "in_progress" | "completed" | "cancelled";
type Priority = "low" | "normal" | "high";

type WorkItem = {
  id: string;
  organizationId: string;
  type: ActivityType;
  title: string;
  description: string | null;
  status: ActivityStatus;
  priority: Priority;
  dueAt: string | null;
  completedAt: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  relatedToType: string | null;
  relatedToId: string | null;
  relatedToName: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

const activityTypes: ActivityType[] = ["task", "call", "meeting", "note", "email"];
const statuses: ActivityStatus[] = ["open", "in_progress", "completed", "cancelled"];
const priorities: Priority[] = ["low", "normal", "high"];
const relatedTypes: RelatedRecordType[] = ["lead", "contact", "company", "deal"];
const pageSizeOptions = [5, 10, 20];

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name: string | null) {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function Icon({
  name,
  size = 18,
}: {
  name: "check" | "calendar" | "search" | "plus" | "chevron";
  size?: number;
}) {
  const paths = {
    check: <path d="m5 12 4 4L19 6" />,
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function formatDueDate(date: string | null, today: string) {
  if (!date) return "No due date";
  const todayDate = new Date(`${today}T12:00:00`);
  const target = new Date(date);
  const isToday = target.toDateString() === todayDate.toDateString();
  const isTomorrow =
    target.toDateString() ===
    new Date(
      todayDate.getFullYear(),
      todayDate.getMonth(),
      todayDate.getDate() + 1,
    ).toDateString();

  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return target.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isActivityType(value: FormDataEntryValue | null): value is ActivityType {
  return typeof value === "string" && activityTypes.some((type) => type === value);
}

function isActivityStatus(value: string): value is ActivityStatus {
  return statuses.some((status) => status === value);
}

function isPriority(value: FormDataEntryValue | null): value is Priority {
  return typeof value === "string" && priorities.some((priority) => priority === value);
}

function isStatus(value: FormDataEntryValue | null): value is ActivityStatus {
  return typeof value === "string" && statuses.some((status) => status === value);
}

type MemberOption = { id: string; name: string };

function AssigneeField({ members, selectedId }: { members: readonly MemberOption[]; selectedId?: string | null }) {
  if (members.length === 0) {
    return (
      <div className="assignee-placeholder">
        <span>Assigned to you by default</span>
        <small>Team assignment is available to organization managers.</small>
      </div>
    );
  }
  return (
    <select name="assignedToUserId" defaultValue={selectedId ?? ""}>
      <option value="">{selectedId === undefined ? "Assign to me" : "Unassigned"}</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>{member.name}</option>
      ))}
    </select>
  );
}

export default function Home() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [assignedToFilter, setAssignedToFilter] = useState("all");
  const [relatedTypeFilter, setRelatedTypeFilter] = useState("all");
  const [relatedIdFilter, setRelatedIdFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [sortBy, setSortBy] = useState<"createdAt" | "dueAt">("createdAt");
  const [sortDescending, setSortDescending] = useState(true);
  const [formError, setFormError] = useState("");
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [relatedOptions, setRelatedOptions] = useState<RelatedRecordOption[]>([]);
  const [relatedOptionsError, setRelatedOptionsError] = useState("");
  const [createRelatedType, setCreateRelatedType] = useState<RelatedRecordType | "">("");
  const [createRelatedId, setCreateRelatedId] = useState("");
  const [createRelatedOptions, setCreateRelatedOptions] = useState<RelatedRecordOption[]>([]);
  const [createRelatedOptionsError, setCreateRelatedOptionsError] = useState("");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [organizationRole, setOrganizationRole] = useState("");
  const [memberOptionsError, setMemberOptionsError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const currentPage = page;
  const visibleItems = items;
  const relatedRecords = relatedOptions;
  const today = new Date().toISOString().slice(0, 10);
  const canWrite = organizationRole !== "" && organizationRole !== "read_only";
  const canArchive = ["owner", "admin", "sales_manager"].includes(organizationRole);
  const canAssign = canArchive && members.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function loadMembers() {
      try {
        const meResponse = await crmApiFetch("/auth/me", { signal: controller.signal });
        const mePayload: unknown = await meResponse.json();
        if (!meResponse.ok) throw new Error(apiErrorMessage(mePayload));
        if (!mePayload || typeof mePayload !== "object" || !("organizations" in mePayload) || !Array.isArray(mePayload.organizations)) {
          throw new Error("The CRM API returned invalid organization membership data.");
        }
        let organizationId = "";
        const savedOrganization = sessionStorage.getItem("myr.organization");
        if (savedOrganization) {
          try {
            const parsed = JSON.parse(savedOrganization) as { id?: unknown };
            if (typeof parsed.id === "string") organizationId = parsed.id;
          } catch { /* Invalid cached organization data is ignored. */ }
        }
        const organization = (mePayload.organizations as { id?: unknown; role?: unknown }[]).find((item) => item.id === organizationId)
          ?? (mePayload.organizations as { id?: unknown; role?: unknown }[])[0];
        if (!organization || typeof organization.role !== "string") return;
        if (!cancelled) setOrganizationRole(organization.role);
        if (!["owner", "admin", "sales_manager"].includes(organization.role)) return;
        const membersResponse = await crmApiFetch("/organizations/assignees", { signal: controller.signal });
        const membersPayload: unknown = await membersResponse.json();
        if (!membersResponse.ok) throw new Error(apiErrorMessage(membersPayload));
        if (!membersPayload || typeof membersPayload !== "object" || !("data" in membersPayload) || !Array.isArray(membersPayload.data)) {
          throw new Error("The CRM API returned invalid member-directory data.");
        }
        if (!cancelled) setMembers(membersPayload.data as MemberOption[]);
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        if (!cancelled) setMemberOptionsError(caught instanceof Error ? caught.message : "Could not load assignable team members.");
      }
    }
    void loadMembers();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(limit),
        sortBy,
        sortOrder: sortDescending ? "desc" : "asc",
      });
      if (query.trim()) params.set("q", query.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (assignedToFilter !== "all") params.set("assignedToUserId", assignedToFilter);
      if (relatedTypeFilter !== "all") params.set("relatedToType", relatedTypeFilter);
      if (relatedIdFilter !== "all" && relatedTypeFilter !== "all") {
        params.set("relatedToId", relatedIdFilter);
      }
      try {
        const response = await crmApiFetch(`/activities?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(payload));
        if (
          !payload
          || typeof payload !== "object"
          || !("data" in payload)
          || !Array.isArray(payload.data)
          || !("meta" in payload)
          || !payload.meta
          || typeof payload.meta !== "object"
        ) {
          throw new Error("The CRM API returned an invalid activity list.");
        }
        const meta = payload.meta as { total?: unknown; totalPages?: unknown };
        if (
          typeof meta.total !== "number"
          || typeof meta.totalPages !== "number"
        ) {
          throw new Error("The CRM API returned invalid activity pagination metadata.");
        }
        if (!cancelled) {
          setItems(payload.data as WorkItem[]);
          setTotal(meta.total);
          setTotalPages(Math.max(1, meta.totalPages));
        }
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not load activities.");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    assignedToFilter,
    limit,
    page,
    query,
    refresh,
    relatedIdFilter,
    relatedTypeFilter,
    sortBy,
    sortDescending,
    statusFilter,
    typeFilter,
    priorityFilter,
  ]);

  useEffect(() => {
    if (relatedTypeFilter === "all") {
      setRelatedOptions([]);
      setRelatedOptionsError("");
      return;
    }
    const controller = new AbortController();
    setRelatedOptionsError("");
    loadRelatedRecordOptions(relatedTypeFilter as RelatedRecordType, controller.signal)
      .then(setRelatedOptions)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setRelatedOptionsError(cause instanceof Error ? cause.message : "Could not load related records.");
        setRelatedOptions([]);
      });
    return () => controller.abort();
  }, [relatedTypeFilter]);

  useEffect(() => {
    if (!isCreateOpen || !createRelatedType) {
      setCreateRelatedOptions([]);
      setCreateRelatedOptionsError("");
      return;
    }
    const controller = new AbortController();
    setCreateRelatedOptionsError("");
    loadRelatedRecordOptions(createRelatedType, controller.signal)
      .then(setCreateRelatedOptions)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setCreateRelatedOptionsError(cause instanceof Error ? cause.message : "Could not load related records.");
        setCreateRelatedOptions([]);
      });
    return () => controller.abort();
  }, [createRelatedType, isCreateOpen]);

  const openCount = items.filter(
    (item) => item.status === "open" || item.status === "in_progress",
  ).length;
  const overdueCount = items.filter(
    (item) =>
      (item.status === "open" || item.status === "in_progress") &&
      item.dueAt !== null &&
      item.dueAt.slice(0, 10) < today,
  ).length;
  const completedCount = items.filter((item) => item.status === "completed").length;
  const activityTypeColors: Record<ActivityType, string> = {
    task: "#7657D8",
    call: "#3277D5",
    meeting: "#24936F",
    note: "#D19A2B",
    email: "#D76670",
  };
  const activityTypeDistribution: DistributionDatum[] = activityTypes.map((type) => ({
    label: formatLabel(type),
    value: visibleItems.filter((item) => item.type === type).length,
    color: activityTypeColors[type],
  }));

  async function setItemStatus(target: WorkItem, status: ActivityStatus) {
    setError("");
    try {
      const response = await crmApiFetch(`/activities/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setNotice(status === "completed" ? `${target.title} completed.` : `${target.title} reopened.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this activity.");
    }
  }

  async function archiveItem(target: WorkItem) {
    if (!window.confirm(`Archive ${target.title}? It will be removed from the active activity list.`)) return;
    setError("");
    try {
      const response = await crmApiFetch(`/activities/${target.id}`, { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setNotice(`${target.title} was archived.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive this activity.");
    }
  }

  async function bulkUpdate(changes: { status?: ActivityStatus; assignedToUserId?: string | null }) {
    if (!selectedIds.length) return;
    setBulkSaving(true); setError(""); setNotice("");
    try {
      const response = await crmApiFetch("/activities/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, ...changes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setSelectedIds([]); setBulkAssignee(""); setNotice(`${selectedIds.length} activities updated.`); setRefresh((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update the selected activities."); }
    finally { setBulkSaving(false); }
  }

  async function bulkArchive() {
    if (!selectedIds.length || !window.confirm(`Archive ${selectedIds.length} selected activities?`)) return;
    setBulkSaving(true); setError(""); setNotice("");
    try {
      const response = await crmApiFetch("/activities/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setSelectedIds([]); setNotice(`${selectedIds.length} activities archived.`); setRefresh((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not archive the selected activities."); }
    finally { setBulkSaving(false); }
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const title = String(formData.get("title") ?? "").trim();
    const type = formData.get("type");
    const priority = formData.get("priority");
    const status = formData.get("status");
    const dueDate = String(formData.get("dueAt") ?? "");
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "").trim();
    const relatedToTypeValue = String(formData.get("relatedToType") ?? "");
    const relatedToId = String(formData.get("relatedToId") ?? "");
    const relatedToType = relatedToTypeValue ? relatedToTypeValue : null;

    if (
      !title ||
      !isActivityType(type) ||
      !isPriority(priority) ||
      !isStatus(status) ||
      (Boolean(relatedToType) !== Boolean(relatedToId))
    ) {
      setFormError("Enter a title and choose valid activity details.");
      return;
    }

    setFormError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        type,
        title,
        description: String(formData.get("description") ?? "").trim() || null,
        priority,
        status,
        dueAt: dueDate ? `${dueDate}T12:00:00.000Z` : null,
        relatedToType,
        relatedToId: relatedToId || null,
      };
      if (editingItem && canAssign) body.assignedToUserId = assignedToUserId || null;
      else if (assignedToUserId) body.assignedToUserId = assignedToUserId;
      const response = await crmApiFetch(editingItem ? `/activities/${editingItem.id}` : "/activities", {
        method: editingItem ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setNotice(editingItem ? "Activity updated." : "Activity created.");
      setPage(1);
      setRefresh((value) => value + 1);
      setIsCreateOpen(false);
      setEditingItem(null);
      setCreateRelatedType("");
      setCreateRelatedId("");
      formElement.reset();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not save this activity.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="activities-screen">
      <div className="page-wrap" id="tasks">
          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR WORK, AT A GLANCE</div>
              <h1>Activities &amp; Tasks</h1>
              <p>Keep track of follow-ups and stay on top of every relationship.</p>
            </div>
            {canWrite && <button
              className="primary-button"
              type="button"
              onClick={() => {
                setEditingItem(null);
                setCreateRelatedType("");
                setCreateRelatedId("");
                setFormError("");
                setIsCreateOpen(true);
              }}
            >
              <Icon name="plus" size={17} />
              Create new
            </button>}
          </section>

          <section className="stats-grid" aria-label="Task summary">
            <article className="stat-card">
              <div className="stat-icon violet"><Icon name="check" /></div>
              <div className="stat-copy">
                <span>Open items</span>
                <strong>{openCount}</strong>
              </div>
              <span className="stat-note">On this page</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon amber"><Icon name="calendar" /></div>
              <div className="stat-copy">
                <span>Overdue</span>
                <strong>{overdueCount}</strong>
              </div>
              <span className="stat-note">On this page</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon green"><Icon name="check" /></div>
              <div className="stat-copy">
                <span>Completed</span>
                <strong>{completedCount}</strong>
              </div>
              <span className="stat-note">On this page</span>
            </article>
          </section>

          <div className="activities-chart-panel">
            <NightingaleChart title="Activity type distribution" items={activityTypeDistribution} />
            <p className="activities-chart-note">Based on the activities currently shown by your filters.</p>
          </div>

          {error && <div className="activities-error" role="alert">{error}</div>}
          {notice && <div className="activities-notice" role="status">{notice}</div>}

          <section className="work-panel" aria-label="Activities and tasks">
            <div className="panel-heading">
              <div>
                <h2>All activities</h2>
                <p>Tasks, calls, meetings, notes, and emails in one place.</p>
              </div>
              <label className="search-field">
                <Icon name="search" size={17} />
                <input
                  type="search"
                  placeholder="Search activities"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  aria-label="Search activities"
                />
                <kbd>/</kbd>
              </label>
            </div>

            <div className="list-toolbar">
              <div className="contract-filters" aria-label="Activity filters">
                <label className="filter-select">
                  <span>Type</span>
                  <select value={typeFilter} onChange={(event) => {
                    const value = event.target.value;
                    setTypeFilter(value === "all" || activityTypes.includes(value as ActivityType) ? value as ActivityType | "all" : "all");
                    setPage(1);
                  }} aria-label="Filter by activity type">
                    <option value="all">All types</option>
                    {activityTypes.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
                  </select>
                </label>
                <label className="filter-select">
                  <span>Priority</span>
                  <select value={priorityFilter} onChange={(event) => {
                    const value = event.target.value;
                    setPriorityFilter(value === "all" || priorities.includes(value as Priority) ? value as Priority | "all" : "all");
                    setPage(1);
                  }} aria-label="Filter by priority">
                    <option value="all">All priorities</option>
                    {priorities.map((priority) => <option key={priority} value={priority}>{formatLabel(priority)}</option>)}
                  </select>
                </label>
                <label className="filter-select">
                  <span>Status</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStatusFilter(value === "all" || isActivityStatus(value) ? value : "all");
                      setPage(1);
                    }}
                    aria-label="Filter by status"
                  >
                    <option value="all">All statuses</option>
                    {statuses.map((status) => (
                      <option key={status} value={status}>{formatLabel(status)}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-select">
                  <span>Assignee</span>
                  <select
                    value={assignedToFilter}
                    onChange={(event) => {
                      setAssignedToFilter(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by assignee"
                  >
                    <option value="all">All assignees</option>
                    <option value="me">My activities</option>
                    {canArchive && <option value="unassigned">Unassigned</option>}
                    {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
                <label className="filter-select">
                  <span>Related type</span>
                  <select
                    value={relatedTypeFilter}
                    onChange={(event) => {
                      setRelatedTypeFilter(event.target.value);
                      setRelatedIdFilter("all");
                      setPage(1);
                    }}
                    aria-label="Filter by related type"
                  >
                    <option value="all">All types</option>
                    {relatedTypes.map((type) => (
                      <option key={type} value={type}>{formatLabel(type)}</option>
                    ))}
                  </select>
                </label>
                <label className="filter-select">
                  <span>Related record</span>
                  <select
                    value={relatedIdFilter}
                    disabled={relatedTypeFilter === "all"}
                    onChange={(event) => {
                      setRelatedIdFilter(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by related record"
                  >
                    <option value="all">All records</option>
                    {relatedRecords
                      .map((record) => (
                        <option key={record.id} value={record.id}>{record.name}</option>
                      ))}
                  </select>
                </label>
                {relatedOptionsError && <span className="filter-error" role="alert">{relatedOptionsError}</span>}
              </div>
              <button
                className="sort-button"
                type="button"
                aria-label={`Sort by ${sortBy === "dueAt" ? "due date" : "created date"} ${sortDescending ? "descending" : "ascending"}`}
                onClick={() => {
                  if (sortBy !== "dueAt") {
                    setSortBy("dueAt");
                    setSortDescending(false);
                  } else {
                    setSortDescending((descending) => !descending);
                  }
                }}
              >
                <Icon name="calendar" size={16} />
                {sortBy === "dueAt" ? "Due date" : "Newest"}
                <span className="sort-chevron">{sortDescending ? "↓" : "↑"}</span>
              </button>
            </div>

            {canWrite && <div className="activity-bulk-toolbar">
              <label><input type="checkbox" checked={visibleItems.length > 0 && visibleItems.every((item) => selectedIds.includes(item.id))} onChange={() => setSelectedIds((current) => visibleItems.length > 0 && visibleItems.every((item) => current.includes(item.id)) ? current.filter((id) => !visibleItems.some((item) => item.id === id)) : [...new Set([...current, ...visibleItems.map((item) => item.id)])])} /> Select page</label>
              <span>{selectedIds.length} selected</span>
              <button type="button" disabled={!selectedIds.length || bulkSaving} onClick={() => void bulkUpdate({ status: "completed" })}>Complete</button>
              <button type="button" disabled={!selectedIds.length || bulkSaving} onClick={() => void bulkUpdate({ status: "open" })}>Reopen</button>
              {canAssign && <><select aria-label="Assign selected activities" value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)}><option value="">Choose assignee…</option><option value="__unassigned__">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" disabled={!selectedIds.length || !bulkAssignee || bulkSaving} onClick={() => void bulkUpdate({ assignedToUserId: bulkAssignee === "__unassigned__" ? null : bulkAssignee })}>Assign</button></>}
              {canArchive && <button type="button" disabled={!selectedIds.length || bulkSaving} onClick={() => void bulkArchive()}>Archive</button>}
            </div>}

            <div className="item-list">
              {loading ? (
                <div className="empty-state" role="status">
                  <strong>Loading activities…</strong>
                </div>
              ) : visibleItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="search" size={22} /></div>
                  <strong>{error ? "Activities could not be loaded" : "No activities found"}</strong>
                  <span>{error ? "Check your connection and try again." : "Try a different search or create a new item."}</span>
                  <button type="button" onClick={() => {
                    if (error) setRefresh((value) => value + 1);
                    else {
                      setFormError("");
                      setIsCreateOpen(true);
                    }
                  }}>
                    {error ? "Retry" : "Create an activity"}
                  </button>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <article className={`work-item${item.status === "completed" ? " is-complete" : ""}`} key={item.id}>
                    {canWrite && <button
                      className={`completion-check${item.status === "completed" ? " checked" : ""}`}
                      type="button"
                      onClick={() => void setItemStatus(
                        item,
                        item.status === "completed" ? "open" : "completed",
                      )}
                      disabled={item.status === "cancelled" || !canWrite}
                      aria-label={item.status === "completed" ? `Mark ${item.title} as open` : `Complete ${item.title}`}
                      aria-pressed={item.status === "completed"}
                    >
                      {item.status === "completed" && <Icon name="check" size={13} />}
                    </button>}
                    <div className="item-main">
                      <div className="item-title-row">
                        <h3>{item.title}</h3>
                        <span className={`type-pill type-${item.type}`}>{formatLabel(item.type)}</span>
                        <span className={`status-pill status-${item.status}`}>{formatLabel(item.status)}</span>
                      </div>
                      <div className="item-meta">
                        <span className={`due-date${(item.status === "open" || item.status === "in_progress") && item.dueAt !== null && item.dueAt.slice(0, 10) < today ? " overdue" : ""}`}>
                          <Icon name="calendar" size={14} />
                          {formatDueDate(item.dueAt, today)}
                        </span>
                        <span className="meta-dot" />
                        <span>{item.relatedToName ?? (item.relatedToType ? formatLabel(item.relatedToType) : "No linked record")}</span>
                      </div>
                    </div>
                    <span className={`priority priority-${item.priority.toLowerCase()}`}>
                      <span />
                      {formatLabel(item.priority)}
                    </span>
                    <div className="assignee">
                      <span className={`assignee-avatar${item.assignedToUserId ? " self" : ""}`}>
                        {getInitials(item.assignedToName)}
                      </span>
                      <span>{item.assignedToName ?? "Unassigned"}</span>
                    </div>
                    {(canWrite || canArchive) && <div className="activity-row-actions">
                      {canWrite && <input className="activity-select-checkbox" type="checkbox" aria-label={`Select ${item.title}`} checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />}
                      {canWrite && <button className="activity-archive" type="button" aria-label={`Edit ${item.title}`} onClick={() => {
                        setEditingItem(item);
                        setCreateRelatedType((item.relatedToType as RelatedRecordType | null) ?? "");
                        setCreateRelatedId(item.relatedToId ?? "");
                        setFormError("");
                        setIsCreateOpen(true);
                      }}>Edit</button>}
                      {canArchive && <button className="activity-archive" type="button" aria-label={`Archive ${item.title}`} onClick={() => void archiveItem(item)}>Archive</button>}
                    </div>}
                  </article>
                ))
              )}
            </div>

            <footer className="list-footer">
              <span>
                Showing <strong>{total ? (currentPage - 1) * limit + 1 : 0}</strong>–<strong>{Math.min(currentPage * limit, total)}</strong> of <strong>{total}</strong> items
              </span>
              <label className="page-size">
                <span>Rows</span>
                <select
                  aria-label="Items per page"
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {pageSizeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={currentPage <= 1}
                aria-label="Previous page"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >‹</button>
              <span className="page-number" aria-live="polite">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                aria-label="Next page"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >›</button>
            </footer>
          </section>
          <p className="data-notice">
            Activities are loaded from your selected organization. Access and changes are enforced by the CRM API.
          </p>
      </div>

      {isCreateOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsCreateOpen(false);
            setCreateRelatedType("");
            setCreateRelatedId("");
            setEditingItem(null);
          }
        }}>
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-heading"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">ACTIVITIES &amp; TASKS</span>
                <h2 id="create-heading">{editingItem ? "Edit activity" : "Create a new item"}</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => { setIsCreateOpen(false); setCreateRelatedType(""); setCreateRelatedId(""); setEditingItem(null); }}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
            <form onSubmit={createItem}>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <label className="form-field">
                <span>Title <b>*</b></span>
                    <input name="title" type="text" placeholder="What needs to get done?" defaultValue={editingItem?.title ?? ""} required autoFocus />
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea name="description" rows={3} placeholder="Add helpful context (optional)" defaultValue={editingItem?.description ?? ""} />
              </label>
              <div className="form-row">
                <label className="form-field">
                  <span>Type</span>
                  <select name="type" defaultValue={editingItem?.type ?? "task"}>
                    {activityTypes.map((type) => (
                      <option key={type} value={type}>{formatLabel(type)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <select name="priority" defaultValue={editingItem?.priority ?? "normal"}>
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>{formatLabel(priority)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>Status</span>
                  <select name="status" defaultValue={editingItem?.status ?? "open"}>
                    {statuses.map((status) => <option key={status} value={status}>{formatLabel(status)}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Due date</span>
                  <input name="dueAt" type="date" defaultValue={editingItem?.dueAt?.slice(0, 10) ?? ""} />
                </label>
                <label className="form-field">
                  <span>Assignee</span>
                  <AssigneeField members={members} selectedId={editingItem?.assignedToUserId} />
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>Related record type</span>
                  <select
                    name="relatedToType"
                    value={createRelatedType}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCreateRelatedType(
                        value === "" || relatedTypes.includes(value as RelatedRecordType)
                          ? value as RelatedRecordType | ""
                          : "",
                      );
                      setCreateRelatedId("");
                    }}
                  >
                    <option value="">No linked record</option>
                    {relatedTypes.map((type) => (
                      <option key={type} value={type}>{formatLabel(type)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Related record</span>
                    <select name="relatedToId" value={createRelatedId} onChange={(event) => setCreateRelatedId(event.target.value)} required={Boolean(createRelatedType)} disabled={!createRelatedType}>
                    <option value="">Select a record</option>
                    {createRelatedOptions.map((record) => (
                      <option key={record.id} value={record.id}>{record.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {createRelatedOptionsError && <p className="form-error" role="alert">{createRelatedOptionsError}</p>}
              {memberOptionsError && <p className="form-error" role="alert">{memberOptionsError}</p>}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => {
                  setIsCreateOpen(false);
                  setCreateRelatedType("");
                  setCreateRelatedId("");
                  setEditingItem(null);
                }}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  <Icon name="plus" size={16} />
                  {saving ? "Saving…" : editingItem ? "Save changes" : "Create item"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
