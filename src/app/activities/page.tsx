"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";

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
  relatedToType: string | null;
  relatedToId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

const demoUsers = [
  { id: "user-alex", name: "You", initials: "AM" },
  { id: "user-jordan", name: "Jordan Lee", initials: "JL" },
];

const demoRelatedRecords = [
  { type: "company", id: "company-acme", name: "Acme Corporation" },
  { type: "company", id: "company-northstar", name: "Northstar Labs" },
  { type: "company", id: "company-brightline", name: "Brightline Studio" },
  { type: "company", id: "company-monarch", name: "Monarch Group" },
  { type: "company", id: "company-evergreen", name: "Evergreen Co." },
  { type: "contact", id: "contact-sam", name: "Sam Rivera" },
];

const initialItems: WorkItem[] = [
  {
    id: "activity-1",
    organizationId: "demo-organization",
    type: "task",
    title: "Send revised proposal",
    description: null,
    status: "open",
    priority: "high",
    dueAt: "2026-10-27T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: "user-alex",
    relatedToType: "company",
    relatedToId: "company-acme",
    createdByUserId: "user-alex",
    createdAt: "2026-10-22T12:00:00.000Z",
    updatedAt: "2026-10-22T12:00:00.000Z",
  },
  {
    id: "activity-2",
    organizationId: "demo-organization",
    type: "call",
    title: "Follow up on product demo",
    description: null,
    status: "in_progress",
    priority: "normal",
    dueAt: "2026-10-27T14:00:00.000Z",
    completedAt: null,
    assignedToUserId: "user-alex",
    relatedToType: "company",
    relatedToId: "company-northstar",
    createdByUserId: "user-alex",
    createdAt: "2026-10-23T12:00:00.000Z",
    updatedAt: "2026-10-24T12:00:00.000Z",
  },
  {
    id: "activity-3",
    organizationId: "demo-organization",
    type: "task",
    title: "Review contract details",
    description: null,
    status: "open",
    priority: "high",
    dueAt: "2026-10-25T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: "user-alex",
    relatedToType: "company",
    relatedToId: "company-brightline",
    createdByUserId: "user-alex",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  },
  {
    id: "activity-4",
    organizationId: "demo-organization",
    type: "meeting",
    title: "Quarterly account check-in",
    description: null,
    status: "open",
    priority: "normal",
    dueAt: "2026-10-28T15:00:00.000Z",
    completedAt: null,
    assignedToUserId: "user-jordan",
    relatedToType: "company",
    relatedToId: "company-monarch",
    createdByUserId: "user-alex",
    createdAt: "2026-10-23T12:00:00.000Z",
    updatedAt: "2026-10-23T12:00:00.000Z",
  },
  {
    id: "activity-5",
    organizationId: "demo-organization",
    type: "email",
    title: "Share onboarding resources",
    description: null,
    status: "open",
    priority: "low",
    dueAt: "2026-10-30T12:00:00.000Z",
    completedAt: null,
    assignedToUserId: "user-alex",
    relatedToType: "company",
    relatedToId: "company-evergreen",
    createdByUserId: "user-alex",
    createdAt: "2026-10-25T12:00:00.000Z",
    updatedAt: "2026-10-25T12:00:00.000Z",
  },
  {
    id: "activity-6",
    organizationId: "demo-organization",
    type: "note",
    title: "Prepare discovery questions",
    description: null,
    status: "completed",
    priority: "low",
    dueAt: "2026-10-26T12:00:00.000Z",
    completedAt: "2026-10-26T15:00:00.000Z",
    assignedToUserId: "user-alex",
    relatedToType: "company",
    relatedToId: "company-acme",
    createdByUserId: "user-alex",
    createdAt: "2026-10-24T12:00:00.000Z",
    updatedAt: "2026-10-26T15:00:00.000Z",
  },
  {
    id: "activity-7",
    organizationId: "demo-organization",
    type: "call",
    title: "Reschedule introduction call",
    description: null,
    status: "cancelled",
    priority: "low",
    dueAt: null,
    completedAt: null,
    assignedToUserId: "user-jordan",
    relatedToType: "contact",
    relatedToId: "contact-sam",
    createdByUserId: "user-alex",
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-25T15:00:00.000Z",
  },
];

const activityTypes: ActivityType[] = ["task", "call", "meeting", "note", "email"];
const statuses: ActivityStatus[] = ["open", "in_progress", "completed", "cancelled"];
const priorities: Priority[] = ["low", "normal", "high"];
const demoToday = "2026-10-27";
const pageSizeOptions = [5, 10, 20];

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getUserName(userId: string | null) {
  return demoUsers.find((user) => user.id === userId)?.name ?? "Unassigned";
}

function getUserInitials(userId: string | null) {
  return demoUsers.find((user) => user.id === userId)?.initials ?? "—";
}

function getRelatedRecord(type: string | null, id: string | null) {
  if (!type || !id) return null;
  return demoRelatedRecords.find(
    (record) => record.type === type && record.id === id,
  );
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

export default function Home() {
  const [items, setItems] = useState(initialItems);
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | "all">("all");
  const [assignedToFilter, setAssignedToFilter] = useState("all");
  const [relatedTypeFilter, setRelatedTypeFilter] = useState("all");
  const [relatedIdFilter, setRelatedIdFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [sortDescending, setSortDescending] = useState(false);
  const [formError, setFormError] = useState("");
  const usersWithItems = demoUsers.filter((user) =>
    items.some((item) => item.assignedToUserId === user.id),
  );
  const relatedTypes = Array.from(
    new Set(
      items
        .map((item) => item.relatedToType)
        .filter((type): type is string => type !== null),
    ),
  );
  const relatedRecords = demoRelatedRecords.filter((record) =>
    items.some(
      (item) => item.relatedToType === record.type && item.relatedToId === record.id,
    ),
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items
      .filter((item) => {
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        if (
          assignedToFilter !== "all" &&
          item.assignedToUserId !== assignedToFilter
        ) return false;
        if (
          relatedTypeFilter !== "all" &&
          item.relatedToType !== relatedTypeFilter
        ) return false;
        if (relatedIdFilter !== "all" && item.relatedToId !== relatedIdFilter) {
          return false;
        }
        if (!normalizedQuery) return true;

        const relatedName = getRelatedRecord(
          item.relatedToType,
          item.relatedToId,
        )?.name;
        return [
          item.title,
          item.type,
          item.status,
          getUserName(item.assignedToUserId),
          relatedName,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (!a.dueAt) return b.dueAt ? 1 : 0;
        if (!b.dueAt) return -1;
        return sortDescending
          ? b.dueAt.localeCompare(a.dueAt)
          : a.dueAt.localeCompare(b.dueAt);
      });
  }, [
    assignedToFilter,
    items,
    query,
    relatedIdFilter,
    relatedTypeFilter,
    sortDescending,
    statusFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / limit));
  const currentPage = Math.min(page, totalPages);
  const visibleItems = filteredItems.slice((currentPage - 1) * limit, currentPage * limit);
  const today = demoToday;
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

  function setItemStatus(target: WorkItem, status: ActivityStatus) {
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.id === target.id
          ? {
              ...item,
              status,
              completedAt:
                status === "completed"
                  ? target.completedAt ?? now
                  : null,
              updatedAt: now,
            }
          : item,
      ),
    );
  }

  function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const type = formData.get("type");
    const priority = formData.get("priority");
    const dueDate = String(formData.get("dueAt") ?? "");
    const assignedToUserId = String(formData.get("assignedToUserId") ?? "");
    const relatedRecordValue = String(formData.get("relatedRecord") ?? "");
    const selectedUser = demoUsers.find((user) => user.id === assignedToUserId);
    const relatedRecord = relatedRecordValue
      ? demoRelatedRecords.find(
          (record) => `${record.type}:${record.id}` === relatedRecordValue,
        )
      : undefined;

    if (
      !title ||
      !isActivityType(type) ||
      !isPriority(priority) ||
      (assignedToUserId && !selectedUser) ||
      (relatedRecordValue && !relatedRecord)
    ) {
      setFormError("Enter a title and choose valid activity details.");
      return;
    }

    setFormError("");
    const now = new Date().toISOString();
    const newItem: WorkItem = {
      id: `activity-${Date.now()}`,
      organizationId: "demo-organization",
      type,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      status: "open",
      priority,
      dueAt: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
      completedAt: null,
      assignedToUserId: selectedUser?.id ?? null,
      relatedToType: relatedRecord?.type ?? null,
      relatedToId: relatedRecord?.id ?? null,
      createdByUserId: "user-alex",
      createdAt: now,
      updatedAt: now,
    };

    setItems((current) => [newItem, ...current]);
    setPage(1);
    setIsCreateOpen(false);
    event.currentTarget.reset();
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
          <span className="workspace-name">Acme Workspace</span>
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
            <span className="profile-avatar">AM</span>
            <span className="profile-copy">
              <strong>Alex Morgan</strong>
              <small>Admin</small>
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
            <span className="demo-badge"><span /> Demo data</span>
            <button
              className="avatar-small"
              type="button"
              aria-label="Open Alex Morgan profile"
            >
              AM
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
              <span className="stat-note">Across your workspace</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon amber"><Icon name="calendar" /></div>
              <div className="stat-copy">
                <span>Overdue</span>
                <strong>{overdueCount}</strong>
              </div>
              <span className="stat-note">Needs your attention</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon green"><Icon name="check" /></div>
              <div className="stat-copy">
                <span>Completed</span>
                <strong>{completedCount}</strong>
              </div>
              <span className="stat-note">In this sample list</span>
            </article>
          </section>

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
                    {usersWithItems.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
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
                    onChange={(event) => {
                      setRelatedIdFilter(event.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter by related record"
                  >
                    <option value="all">All records</option>
                    {relatedRecords
                      .filter((record) =>
                        relatedTypeFilter === "all" ||
                        record.type === relatedTypeFilter,
                      )
                      .map((record) => (
                        <option key={record.id} value={record.id}>{record.name}</option>
                      ))}
                  </select>
                </label>
              </div>
              <button
                className="sort-button"
                type="button"
                aria-label={`Sort by due date ${sortDescending ? "ascending" : "descending"}`}
                onClick={() => setSortDescending((descending) => !descending)}
              >
                <Icon name="calendar" size={16} />
                Due date
                <span className="sort-chevron">{sortDescending ? "↑" : "↓"}</span>
              </button>
            </div>

            <div className="item-list">
              {visibleItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="search" size={22} /></div>
                  <strong>No activities found</strong>
                  <span>Try a different search or create a new item.</span>
                  <button type="button" onClick={() => {
                    setFormError("");
                    setIsCreateOpen(true);
                  }}>
                    Create an activity
                  </button>
                </div>
              ) : (
                visibleItems.map((item) => (
                  <article className={`work-item${item.status === "completed" ? " is-complete" : ""}`} key={item.id}>
                    <button
                      className={`completion-check${item.status === "completed" ? " checked" : ""}`}
                      type="button"
                      onClick={() => setItemStatus(
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
                        <span>{getRelatedRecord(item.relatedToType, item.relatedToId)?.name ?? "No linked record"}</span>
                      </div>
                    </div>
                    <span className={`priority priority-${item.priority.toLowerCase()}`}>
                      <span />
                      {formatLabel(item.priority)}
                    </span>
                    <div className="assignee">
                      <span className={`assignee-avatar${item.assignedToUserId === "user-alex" ? " self" : ""}`}>
                        {getUserInitials(item.assignedToUserId)}
                      </span>
                      <span>{getUserName(item.assignedToUserId)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <footer className="list-footer">
              <span>
                Showing <strong>{filteredItems.length ? (currentPage - 1) * limit + 1 : 0}</strong>–<strong>{Math.min(currentPage * limit, filteredItems.length)}</strong> of <strong>{filteredItems.length}</strong> items
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
            This screen uses sample data for the initial UI. Changes are temporary and will reset when you refresh.
          </p>
        </div>
      </main>

      {isCreateOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsCreateOpen(false);
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
                  <select name="assignedToUserId" defaultValue="user-alex">
                    {demoUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                    <option value="">Unassigned</option>
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>Related record</span>
                  <select name="relatedRecord" defaultValue="">
                    <option value="">No linked record</option>
                    {demoRelatedRecords.map((record) => (
                      <option
                        key={record.id}
                        value={`${record.type}:${record.id}`}
                      >
                        {formatLabel(record.type)}: {record.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="modal-actions">
                <button className="secondary-button" type="button" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  <Icon name="plus" size={16} />
                  Create item
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
