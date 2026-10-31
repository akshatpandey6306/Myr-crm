"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { crmApiFetch } from "../../../lib/api-client";

type Trigger = "lead_created" | "lead_status_changed";
type LeadStatus = "new" | "contacted" | "qualified" | "disqualified";
type Priority = "low" | "normal" | "high";
type AutomationRule = {
  id: string;
  name: string;
  trigger: Trigger;
  triggerStatus: LeadStatus | null;
  activityTitle: string;
  activityPriority: Priority;
  dueInDays: number;
  enabled: boolean;
  runCount: number;
  lastRunAt: string | null;
};
type AutomationRun = { id: string; leadName: string; leadCompany: string; activityId: string; ranAt: string };

const statuses: LeadStatus[] = ["new", "contacted", "qualified", "disqualified"];
const priorities: Priority[] = ["low", "normal", "high"];

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Something went wrong. Please try again.";
  const error = payload as { error?: { message?: unknown }; message?: unknown };
  const message = error.error?.message ?? error.message;
  return typeof message === "string" ? message : "Something went wrong. Please try again.";
}

function triggerDescription(rule: AutomationRule) {
  return rule.trigger === "lead_created"
    ? "When a lead is created"
    : `When a lead becomes ${rule.triggerStatus ?? "—"}`;
}

function formatLastRun(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

export default function AutomationsManager() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [trigger, setTrigger] = useState<Trigger>("lead_created");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState("");
  const [runsByRule, setRunsByRule] = useState<Record<string, AutomationRun[]>>({});
  const [loadingRunsFor, setLoadingRunsFor] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    crmApiFetch("/auth/me", { signal: controller.signal })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object" || !("organizations" in payload) || !Array.isArray(payload.organizations)) return;
        let selectedOrganizationId = "";
        try {
          const stored = sessionStorage.getItem("myr.organization");
          const parsed = stored ? JSON.parse(stored) as { id?: unknown } : null;
          if (parsed && typeof parsed.id === "string") selectedOrganizationId = parsed.id;
        } catch { /* Ignore invalid cached organization data. */ }
        const selected = (payload.organizations as { id?: unknown; role?: unknown }[]).find((organization) => organization.id === selectedOrganizationId)
          ?? (payload.organizations as { id?: unknown; role?: unknown }[])[0];
        if (!controller.signal.aborted && selected && typeof selected.role === "string") {
          setCanManage(["owner", "admin", "sales_manager"].includes(selected.role));
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await crmApiFetch("/automations", { signal: controller.signal });
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload));
        if (
          !payload
          || typeof payload !== "object"
          || !("data" in payload)
          || !Array.isArray(payload.data)
        ) {
          throw new Error("The CRM API returned an invalid automation list.");
        }
        if (!cancelled) setRules(payload.data as AutomationRule[]);
      } catch (caught) {
        if (cancelled || (caught instanceof Error && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Could not load automations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refresh]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = {
      name: String(formData.get("name") ?? "").trim(),
      trigger,
      triggerStatus: trigger === "lead_status_changed" ? String(formData.get("triggerStatus") ?? "") : null,
      activityTitle: String(formData.get("activityTitle") ?? "").trim(),
      activityPriority: String(formData.get("activityPriority") ?? "normal"),
      dueInDays: Number(formData.get("dueInDays") ?? 1),
    };
    setSaving(true);
    setError("");
    try {
      const response = await crmApiFetch("/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setShowForm(false);
      setNotice("Automation rule created.");
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create this automation.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    setError("");
    try {
      const response = await crmApiFetch(`/automations/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setNotice(`${rule.name} ${rule.enabled ? "paused" : "enabled"}.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this automation.");
    }
  }

  async function archiveRule(rule: AutomationRule) {
    if (!window.confirm(`Archive "${rule.name}"? It will stop running.`)) return;
    setError("");
    try {
      const response = await crmApiFetch(`/automations/${rule.id}`, { method: "DELETE" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setNotice(`${rule.name} was archived.`);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive this automation.");
    }
  }

  async function toggleRuns(rule: AutomationRule) {
    if (expandedRuleId === rule.id) {
      setExpandedRuleId("");
      return;
    }
    setExpandedRuleId(rule.id);
    if (rule.id in runsByRule) return;
    setLoadingRunsFor(rule.id);
    setError("");
    try {
      const response = await crmApiFetch(`/automations/${rule.id}/runs`);
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
        throw new Error("The CRM API returned invalid automation run history.");
      }
      setRunsByRule((current) => ({ ...current, [rule.id]: payload.data as AutomationRun[] }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load automation runs.");
      setExpandedRuleId("");
    } finally {
      setLoadingRunsFor("");
    }
  }

  return (
    <section className="automation-feature">
      <div className="leads-page-heading">
        <div>
          <p className="date-label">WORKSPACE / AUTOMATION</p>
          <h1>Automation</h1>
          <p className="welcome-copy">Create follow-up tasks automatically when leads enter your workflow.</p>
        </div>
        {canManage && <button className="button button-primary" type="button" onClick={() => { setError(""); setShowForm((value) => !value); }}>
          <span aria-hidden="true">＋</span> {showForm ? "Cancel" : "Create rule"}
        </button>}
      </div>

      {notice && <div className="module-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button></div>}
      {error && <div className="leads-error" role="alert"><span>{error}</span>{error.includes("sign in") || error.includes("Authenticated") ? <Link href="/sign-in">Sign in</Link> : <button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button>}</div>}

      {showForm && canManage && (
        <form className="panel automation-form" onSubmit={(event) => void createRule(event)}>
          <div className="automation-form-heading">
            <div><h2>New automation</h2><p>Choose a lead event and the follow-up task to create.</p></div>
          </div>
          <div className="automation-form-grid">
            <label>Rule name<input name="name" required maxLength={120} placeholder="New lead follow-up" /></label>
            <label>When<select value={trigger} onChange={(event) => setTrigger(event.target.value as Trigger)}><option value="lead_created">A lead is created</option><option value="lead_status_changed">A lead reaches a status</option></select></label>
            {trigger === "lead_status_changed" && <label>Lead status<select name="triggerStatus" defaultValue="qualified">{statuses.map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</select></label>}
            <label>Task title<input name="activityTitle" required maxLength={160} defaultValue="Follow up with {{leadName}}" /><small>Use <code>{"{{leadName}}"}</code> to include the lead’s name.</small></label>
            <label>Task priority<select name="activityPriority" defaultValue="normal">{priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
            <label>Due in days<input name="dueInDays" type="number" min={0} max={365} defaultValue={1} required /></label>
          </div>
          <div className="automation-form-footer"><span>Rules run once per lead. Tasks are assigned to the lead owner.</span><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create automation"}</button></div>
        </form>
      )}

      <section className="panel automation-list" aria-label="Automation rules">
        <header className="automation-list-heading"><div><h2>Your rules</h2><p>{loading ? "Loading rules…" : `${rules.length} ${rules.length === 1 ? "rule" : "rules"} in this organization`}</p></div><span className="automation-secure-label">Organization scoped</span></header>
        {loading ? (
          <div className="automation-empty" role="status">Loading automations…</div>
        ) : rules.length === 0 ? (
          <div className="automation-empty"><span aria-hidden="true">✳</span><strong>No automation rules yet</strong><p>Create a rule to add follow-up tasks when leads are created or change status.</p></div>
        ) : (
          <div className="automation-rule-list">
            {rules.map((rule) => (
              <article className="automation-rule" key={rule.id}>
                <div className="automation-rule-icon" aria-hidden="true">✳</div>
                <div className="automation-rule-main">
                  <div className="automation-rule-title"><h3>{rule.name}</h3><span className={`automation-state${rule.enabled ? " is-enabled" : ""}`}>{rule.enabled ? "Active" : "Paused"}</span></div>
                  <p>{triggerDescription(rule)} <span aria-hidden="true">→</span> Create task: <strong>{rule.activityTitle}</strong></p>
                  <small>{rule.activityPriority} priority · Due in {rule.dueInDays} {rule.dueInDays === 1 ? "day" : "days"} · Last run: {formatLastRun(rule.lastRunAt)}</small>
                </div>
                <div className="automation-rule-stats"><strong>{rule.runCount}</strong><span>{rule.runCount === 1 ? "run" : "runs"}</span></div>
                <div className="automation-rule-actions">
                  <button type="button" onClick={() => void toggleRuns(rule)} aria-expanded={expandedRuleId === rule.id} aria-label={`${expandedRuleId === rule.id ? "Hide" : "View"} runs for ${rule.name}`}>{expandedRuleId === rule.id ? "Hide runs" : "View runs"}</button>
                  {canManage && <>
                    <button type="button" onClick={() => void toggleRule(rule)} aria-label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`}>{rule.enabled ? "Pause" : "Enable"}</button>
                    <button type="button" className="automation-archive" onClick={() => void archiveRule(rule)} aria-label={`Archive ${rule.name}`}>Archive</button>
                  </>}
                </div>
                {expandedRuleId === rule.id && <div className="automation-run-history" aria-label={`Recent runs for ${rule.name}`}>
                  <h4>Recent runs</h4>
                  {loadingRunsFor === rule.id ? <p role="status">Loading runs…</p> : (runsByRule[rule.id] ?? []).length === 0 ? <p>This rule has not run yet.</p> : <ul>{runsByRule[rule.id].map((run) => <li key={run.id}><span><strong>{run.leadName}</strong>{run.leadCompany ? ` · ${run.leadCompany}` : ""}</span><time dateTime={run.ranAt}>{formatLastRun(run.ranAt)}</time></li>)}</ul>}
                </div>}
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="automation-footnote">Lead changes and generated tasks are saved together. Each rule runs at most once for a given lead.</p>
    </section>
  );
}
