"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type ItemType = "Task" | "Call" | "Meeting" | "Email";
type Priority = "High" | "Medium" | "Low";

type WorkItem = {
  id: number;
  title: string;
  type: ItemType;
  dueDate: string;
  priority: Priority;
  assignee: string;
  relatedTo: string;
  completed: boolean;
};

const initialItems: WorkItem[] = [
  {
    id: 1,
    title: "Send revised proposal",
    type: "Task",
    dueDate: "2026-10-27",
    priority: "High",
    assignee: "You",
    relatedTo: "Acme Corporation",
    completed: false,
  },
  {
    id: 2,
    title: "Follow up on product demo",
    type: "Call",
    dueDate: "2026-10-27",
    priority: "Medium",
    assignee: "You",
    relatedTo: "Northstar Labs",
    completed: false,
  },
  {
    id: 3,
    title: "Review contract details",
    type: "Task",
    dueDate: "2026-10-25",
    priority: "High",
    assignee: "You",
    relatedTo: "Brightline Studio",
    completed: false,
  },
  {
    id: 4,
    title: "Quarterly account check-in",
    type: "Meeting",
    dueDate: "2026-10-28",
    priority: "Medium",
    assignee: "Jordan Lee",
    relatedTo: "Monarch Group",
    completed: false,
  },
  {
    id: 5,
    title: "Share onboarding resources",
    type: "Email",
    dueDate: "2026-10-30",
    priority: "Low",
    assignee: "You",
    relatedTo: "Evergreen Co.",
    completed: false,
  },
  {
    id: 6,
    title: "Prepare discovery questions",
    type: "Task",
    dueDate: "2026-10-26",
    priority: "Low",
    assignee: "You",
    relatedTo: "Acme Corporation",
    completed: true,
  },
];

const filters = ["All items", "Open", "Completed"] as const;
type Filter = (typeof filters)[number];
const demoToday = "2026-10-27";

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

function formatDueDate(date: string, today: string) {
  const todayDate = new Date(`${today}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
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

function isItemType(value: FormDataEntryValue | null): value is ItemType {
  return value === "Task" || value === "Call" || value === "Meeting" || value === "Email";
}

function isPriority(value: FormDataEntryValue | null): value is Priority {
  return value === "High" || value === "Medium" || value === "Low";
}

export default function Home() {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>("All items");
  const [query, setQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [sortDescending, setSortDescending] = useState(false);
  const [formError, setFormError] = useState("");

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items
      .filter((item) => {
        if (filter === "Open" && item.completed) return false;
        if (filter === "Completed" && !item.completed) return false;
        if (!normalizedQuery) return true;

        return [item.title, item.type, item.assignee, item.relatedTo]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) =>
        sortDescending
          ? b.dueDate.localeCompare(a.dueDate)
          : a.dueDate.localeCompare(b.dueDate),
      );
  }, [filter, items, query, sortDescending]);

  const today = demoToday;
  const openCount = items.filter((item) => !item.completed).length;
  const overdueCount = items.filter(
    (item) => !item.completed && item.dueDate < today,
  ).length;
  const completedCount = items.filter((item) => item.completed).length;

  function toggleCompleted(id: number) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item,
      ),
    );
  }

  function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const type = formData.get("type");
    const priority = formData.get("priority");
    const dueDate = formData.get("dueDate");

    if (
      !title ||
      !isItemType(type) ||
      !isPriority(priority) ||
      typeof dueDate !== "string" ||
      !dueDate
    ) {
      setFormError("Enter a title and due date, then choose a valid type and priority.");
      return;
    }

    setFormError("");
    const newItem: WorkItem = {
      id: Date.now(),
      title,
      type,
      dueDate,
      priority,
      assignee: "You",
      relatedTo: String(formData.get("relatedTo") ?? "").trim() || "No linked record",
      completed: false,
    };

    setItems((current) => [newItem, ...current]);
    setIsCreateOpen(false);
    event.currentTarget.reset();
  }

  return (
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
                <p>Tasks, calls, meetings, and emails in one place.</p>
              </div>
              <label className="search-field">
                <Icon name="search" size={17} />
                <input
                  type="search"
                  placeholder="Search activities"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search activities"
                />
                <kbd>/</kbd>
              </label>
            </div>

            <div className="list-toolbar">
              <div className="filter-tabs" role="tablist" aria-label="Filter activities">
                {filters.map((option) => (
                  <button
                    className={`filter-tab${filter === option ? " selected" : ""}`}
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={filter === option}
                    onClick={() => setFilter(option)}
                  >
                    {option}
                    {option === "All items" && <span>{items.length}</span>}
                  </button>
                ))}
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
                  <article className={`work-item${item.completed ? " is-complete" : ""}`} key={item.id}>
                    <button
                      className={`completion-check${item.completed ? " checked" : ""}`}
                      type="button"
                      onClick={() => toggleCompleted(item.id)}
                      aria-label={item.completed ? `Mark ${item.title} as open` : `Complete ${item.title}`}
                      aria-pressed={item.completed}
                    >
                      {item.completed && <Icon name="check" size={13} />}
                    </button>
                    <div className="item-main">
                      <div className="item-title-row">
                        <h3>{item.title}</h3>
                        <span className={`type-pill type-${item.type.toLowerCase()}`}>{item.type}</span>
                      </div>
                      <div className="item-meta">
                        <span className={`due-date${!item.completed && item.dueDate < today ? " overdue" : ""}`}>
                          <Icon name="calendar" size={14} />
                          {formatDueDate(item.dueDate, today)}
                        </span>
                        <span className="meta-dot" />
                        <span>{item.relatedTo}</span>
                      </div>
                    </div>
                    <span className={`priority priority-${item.priority.toLowerCase()}`}>
                      <span />
                      {item.priority}
                    </span>
                    <div className="assignee">
                      <span className={`assignee-avatar${item.assignee === "You" ? " self" : ""}`}>
                        {item.assignee === "You" ? "AM" : "JL"}
                      </span>
                      <span>{item.assignee}</span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <footer className="list-footer">
              <span>Showing <strong>{visibleItems.length}</strong> of <strong>{items.length}</strong> items</span>
              <button type="button" disabled aria-label="Previous page">‹</button>
              <span className="page-number">1</span>
              <button type="button" disabled aria-label="Next page">›</button>
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
              <div className="form-row">
                <label className="form-field">
                  <span>Type</span>
                  <select name="type" defaultValue="Task">
                    <option>Task</option>
                    <option>Call</option>
                    <option>Meeting</option>
                    <option>Email</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>Priority</span>
                  <select name="priority" defaultValue="Medium">
                    <option>High</option>
                    <option>Medium</option>
                    <option>Low</option>
                  </select>
                </label>
              </div>
              <div className="form-row">
                <label className="form-field">
                  <span>Due date <b>*</b></span>
                  <input name="dueDate" type="date" defaultValue={today} required />
                </label>
                <label className="form-field">
                  <span>Related to</span>
                  <input name="relatedTo" type="text" placeholder="Company or contact" />
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
  );
}
