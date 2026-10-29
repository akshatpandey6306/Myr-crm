"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  apiErrorMessage,
  loadRelatedRecordOptions,
} from "./activity-api";
import type { RelatedRecordOption, RelatedRecordType } from "./activity-api";
import { crmApiFetch } from "../../lib/api-client";

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

type MemberOption = { id: string; name: string };

function AssigneeField({ members }: { members: readonly MemberOption[] }) {
  if (members.length === 0) {
    return (
      <div className="assignee-placeholder">
        <span>Assigned to you by default</span>
        <small>Team assignment will be available when the member directory is connected.</small>
      </div>
    );
  }
  return (
    <select name="assignedToUserId" defaultValue="">
      <option value="">Assign to me</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>{member.name}</option>
      ))}
    </select>
  );
}

export default function Home() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | "all">("all");
  const [assignedToFilter, setAssignedToFilter] = useState("all");
  const [relatedTypeFilter, setRelatedTypeFilter] = useState("all");
  const [relatedIdFilter, setRelatedIdFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
  const [createRelatedOptions, setCreateRelatedOptions] = useState<RelatedRecordOption[]>([]);
  const [createRelatedOptionsError, setCreateRelatedOptionsError] = useState("");
  const currentPage = page;
  const visibleItems = items;
  const relatedRecords = relatedOptions;
  const today = new Date().toISOString().slice(0, 10);
  const members: MemberOption[] = [];

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

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const title = String(formData.get("title") ?? "").trim();
    const type = formData.get("type");
    const priority = formData.get("priority");
    const dueDate = String(formData.get("dueAt") ?? "");
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "").trim();
    const relatedToTypeValue = String(formData.get("relatedToType") ?? "");
    const relatedToId = String(formData.get("relatedToId") ?? "");
    const relatedToType = relatedToTypeValue ? relatedToTypeValue : null;

    if (
      !title ||
      !isActivityType(type) ||
      !isPriority(priority) ||
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
        dueAt: dueDate ? `${dueDate}T12:00:00.000Z` : null,
        relatedToType,
        relatedToId: relatedToId || null,
      };
      if (assignedToUserId) body.assignedToUserId = assignedToUserId;
      const response = await crmApiFetch("/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(payload));
      setNotice("Activity created.");
      setPage(1);
      setRefresh((value) => value + 1);
      setIsCreateOpen(false);
      setCreateRelatedType("");
      formElement.reset();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Could not create this activity.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="activities-screen">
      <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Myr CRM home">
          <span className="brand-mark">m</span>
          <span>myr<span className="brand-light">crm</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switcher" type="button">
          <span className="workspace-avatar">A</span>
          <span className="workspace-name">Active organization</span>
          <span className="switcher-chevron">⌄</span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#tasks" aria-current="page">
            <Icon name="check" />
            <span>Activities &amp; Tasks</span>
            <span className="nav-count">{openCount}</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">?</div>
            <div>
              <strong>Need a hand?</strong>
              <span>Visit the help center</span>
            </div>
            <Icon name="chevron" size={16} />
          </div>
          <button className="profile" type="button">
            <span className="profile-avatar">CRM</span>
            <span className="profile-copy">
              <strong>Signed-in member</strong>
              <small>CRM workspace</small>
            </span>
            <span className="profile-menu">•••</span>
          </button>
        </div>
      </aside>

      <main className="main-content" id="tasks">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <Icon name="chevron" size={14} />
            <strong>Activities &amp; Tasks</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-badge"><span /> CRM data</span>
            <button
              className="avatar-small"
              type="button"
              aria-label="Signed-in member profile"
            >
              CRM
            </button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow">YOUR WORK, AT A GLANCE</div>
              <h1>Activities &amp; Tasks</h1>
              <p>Keep track of follow-ups and stay on top of every relationship.</p>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setFormError("");
                setIsCreateOpen(true);
              }}
            >
              <Icon name="plus" size={17} />
              Create new
            </button>
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
                    <button
                      className={`completion-check${item.status === "completed" ? " checked" : ""}`}
                      type="button"
                      onClick={() => void setItemStatus(
                        item,
                        item.status === "completed" ? "open" : "completed",
                      )}
                      disabled={item.status === "cancelled"}
                      aria-label={item.status === "completed" ? `Mark ${item.title} as open` : `Complete ${item.title}`}
                      aria-pressed={item.status === "completed"}
                    >
                      {item.status === "completed" && <Icon name="check" size={13} />}
                    </button>
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
                    <button
                      className="activity-archive"
                      type="button"
                      aria-label={`Archive ${item.title}`}
                      onClick={() => void archiveItem(item)}
                    >
                      Archive
                    </button>
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
      </main>

      {isCreateOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsCreateOpen(false);
            setCreateRelatedType("");
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
                <h2 id="create-heading">Create a new item</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                onClick={() => setIsCreateOpen(false)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>
            <form onSubmit={createItem}>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <label className="form-field">
                <span>Title <b>*</b></span>
                <input name="title" type="text" placeholder="What needs to get done?" required autoFocus />
              </label>
              <label className="form-field">
                <span>Description</span>
                <textarea name="description" rows={3} placeholder="Add helpful context (optional)" />
              </label>
              <div className="form-row">
                <label className="form-field">
                  <span>Type</span>
                  <select name="type" defaultValue="task">
                    {activityTypes.map((type) => (
                      <option key={type} value={type}>{formatLabel(type)}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <select name="priority" defaultValue="normal">
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>{formatLabel(priority)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>Due date</span>
                  <input name="dueAt" type="date" />
                </label>
                <label className="form-field">
                  <span>Assignee</span>
                  <AssigneeField members={members} />
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
                  <select name="relatedToId" defaultValue="" required={Boolean(createRelatedType)} disabled={!createRelatedType}>
                    <option value="">Select a record</option>
                    {createRelatedOptions.map((record) => (
                      <option key={record.id} value={record.id}>{record.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {createRelatedOptionsError && <p className="form-error" role="alert">{createRelatedOptionsError}</p>}
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => {
                  setIsCreateOpen(false);
                  setCreateRelatedType("");
                }}>
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  <Icon name="plus" size={16} />
                  {saving ? "Creating…" : "Create item"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      </div>
    </div>
  );
}
