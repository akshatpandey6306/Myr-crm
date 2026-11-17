'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { crmApiFetch } from '../../../lib/api-client';
import { createCsv, downloadCsv, parseCsv } from '../../../lib/csv';
import LeadCsvImport from '../leads/LeadCsvImport';
import styles from './MembersManager.module.css';

type Role = 'owner' | 'admin' | 'sales_manager' | 'sales_rep' | 'read_only';
type Member = { userId: string; name: string; email: string; role: Role; customRoleId?: string | null; customRoleName?: string | null; reactivated?: boolean; enabledModules: string[]; emailVerified: boolean; joinedAt: string };
type WorkspaceRole = { id: string; name: string; description: string; permissionProfile: Exclude<Role, 'owner'> };
type MembershipRequest = { userId: string; name: string; email: string; requestedAt: string };
type SessionActivity = { name: string; email: string; loginAt: string; logoutAt: string | null; lastSeenAt: string; status: 'active' | 'signed_out' | 'expired'; device: string };
type EmployeeImportRow = { name: string; email: string; password: string; localErrors?: string[] };
type EmployeeImportPreview = { row: number; name: string; email: string; errors: string[] };

const employeeCsvTemplate = createCsv(['work_email', 'name', 'password'], []);
const maxImportRequestBytes = 80 * 1024;
const moduleLabels: Record<string, string> = {
  leads: 'Leads',
  contacts: 'Contacts',
  companies: 'Companies',
  deals: 'Deals',
  activities: 'Activities',
  automation: 'Automation',
  email: 'Email',
  reports: 'Reports',
  'audit-logs': 'Audit Logs',
  settings: 'Settings',
};

const roleOptions: { value: Exclude<Role, 'owner'>; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'sales_rep', label: 'Sales Representative' },
  { value: 'read_only', label: 'Read-only User' },
];
const roleLabel = (value: string, customRoles: WorkspaceRole[]) => customRoles.find((role) => role.id === value)?.name ?? roleOptions.find((role) => role.value === value)?.label ?? value.replaceAll('_', ' ');

async function responseMessage(response: Response) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? 'The request could not be completed.');
  return payload;
}

export default function MembersManager() {
  const [members, setMembers] = useState<Member[]>([]);
  const [sessionActivity, setSessionActivity] = useState<SessionActivity[]>([]);
  const [requests, setRequests] = useState<MembershipRequest[]>([]);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [employeeCsvRows, setEmployeeCsvRows] = useState<EmployeeImportRow[]>([]);
  const [employeeCsvPreview, setEmployeeCsvPreview] = useState<EmployeeImportPreview[]>([]);
  const [employeeCsvFileName, setEmployeeCsvFileName] = useState('');
  const [employeeCsvError, setEmployeeCsvError] = useState('');
  const [employeeCsvNotice, setEmployeeCsvNotice] = useState('');
  const [employeeCsvBusy, setEmployeeCsvBusy] = useState(false);
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [workspaceRoles, setWorkspaceRoles] = useState<WorkspaceRole[]>([]);
  const [editingModulesFor, setEditingModulesFor] = useState<Member | null>(null);
  const [moduleDraft, setModuleDraft] = useState<string[]>([]);
  const [savingModules, setSavingModules] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ name: '', email: '', password: '', role: 'sales_rep' });
  const [creatingEmployee, setCreatingEmployee] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [membersResponse, requestsResponse, meResponse, modulesResponse, sessionsResponse, rolesResponse] = await Promise.all([
        crmApiFetch('/organizations/members'),
        crmApiFetch('/organizations/membership-requests'),
        crmApiFetch('/auth/me'),
        crmApiFetch('/organizations/modules'),
        crmApiFetch('/organizations/members/session-history'),
        crmApiFetch('/organizations/roles'),
      ]);
      const [membersPayload, requestsPayload, mePayload, modulesPayload, sessionsPayload, rolesPayload] = await Promise.all([
        responseMessage(membersResponse),
        responseMessage(requestsResponse),
        responseMessage(meResponse),
        responseMessage(modulesResponse),
        responseMessage(sessionsResponse),
        responseMessage(rolesResponse),
      ]);
      setMembers(membersPayload.data as Member[]);
      setSessionActivity(Array.isArray(sessionsPayload.data) ? sessionsPayload.data as SessionActivity[] : []);
      const assignableModules = Array.isArray(modulesPayload.data.assignableModules)
        ? modulesPayload.data.assignableModules
        : modulesPayload.data.enabledModules;
      setAvailableModules(assignableModules.filter((module: string) => module !== 'team'));
      setRequests(requestsPayload.data as MembershipRequest[]);
      setWorkspaceRoles(Array.isArray(rolesPayload.data) ? rolesPayload.data as WorkspaceRole[] : []);
      const saved = sessionStorage.getItem('myr.organization');
      let organizationId = '';
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { id?: unknown };
          if (typeof parsed.id === 'string') organizationId = parsed.id;
        } catch { /* Invalid cached organization data is ignored. */ }
      }
      const activeOrganization = (mePayload.organizations as { id: string; role: Role }[]).find((organization) => organization.id === organizationId)
        ?? (mePayload.organizations as { id: string; role: Role }[])[0];
      setCurrentRole(activeOrganization?.role ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load organization members.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function validateEmployeeCsv(rows: EmployeeImportRow[]) {
    setEmployeeCsvBusy(true);
    setEmployeeCsvError('');
    setEmployeeCsvNotice('');
    try {
      const response = await crmApiFetch('/organizations/members/import/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows.map(({ name, email }) => ({ name, email })) }),
      });
      const payload = await responseMessage(response);
      const previewRows = (payload.data.rows as EmployeeImportPreview[]).map((row, index) => {
        const password = rows[index]?.password ?? '';
        const localErrors = [
          ...(password.length < 8 || password.length > 128 ? ['Password must contain 8 to 128 characters.'] : []),
          ...(rows[index]?.localErrors ?? []),
        ];
        return { ...row, errors: [...row.errors, ...localErrors] };
      });
      setEmployeeCsvPreview(previewRows);
      if (!payload.data.canImport || previewRows.some(({ errors }) => errors.length > 0)) {
        setEmployeeCsvError('Fix the row errors below before importing employees.');
      }
    } catch (caught) {
      setEmployeeCsvError(caught instanceof Error ? caught.message : 'Could not validate this employee file.');
      setEmployeeCsvPreview([]);
    } finally {
      setEmployeeCsvBusy(false);
    }
  }

  async function chooseEmployeeCsv(file: File | undefined) {
    if (!file) return;
    setEmployeeCsvFileName(file.name);
    setEmployeeCsvError('');
    setEmployeeCsvNotice('');
    setEmployeeCsvPreview([]);
    if (file.size > 5 * 1024 * 1024) {
      setEmployeeCsvRows([]);
      setEmployeeCsvError('CSV files must be 5 MB or smaller.');
      return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      const [headerRow, ...dataRows] = parseCsv(text);
      if (!headerRow || dataRows.length === 0) throw new Error('Choose a non-empty CSV with a header and at least one employee.');
      const headers = headerRow.map((header) => header.trim().toLowerCase());
      const emailIndex = headers.indexOf('work_email') >= 0 ? headers.indexOf('work_email') : headers.indexOf('email');
      const nameIndex = headers.indexOf('name');
      const passwordIndex = headers.indexOf('password');
      if (emailIndex < 0 || nameIndex < 0 || passwordIndex < 0) {
        throw new Error('Required columns are work_email (or email), name, and password. Download the template for an example.');
      }
      const rows = dataRows.map((values) => ({
        email: values[emailIndex] ?? '',
        name: values[nameIndex] ?? '',
        password: values[passwordIndex] ?? '',
        ...(values.length !== headerRow.length ? { localErrors: ['CSV row has a different number of columns than the header.'] } : {}),
      }));
      if (rows.length > 500) throw new Error('Import no more than 500 employees at a time.');
      if (new TextEncoder().encode(JSON.stringify({ rows })).byteLength > maxImportRequestBytes) {
        rows[0]?.localErrors?.push('Import request is too large. Split this file into smaller batches.');
        if (rows[0] && !rows[0].localErrors) rows[0].localErrors = ['Import request is too large. Split this file into smaller batches.'];
      }
      setEmployeeCsvRows(rows);
      await validateEmployeeCsv(rows);
    } catch (caught) {
      setEmployeeCsvRows([]);
      setEmployeeCsvError(caught instanceof Error ? caught.message : 'Could not read this CSV file as UTF-8.');
    }
  }

  async function importEmployees() {
    if (new TextEncoder().encode(JSON.stringify({ rows: employeeCsvRows })).byteLength > maxImportRequestBytes) {
      setEmployeeCsvError('Import request is too large. Split this file into smaller batches.');
      return;
    }
    setEmployeeCsvBusy(true);
    setEmployeeCsvError('');
    setEmployeeCsvNotice('');
    try {
      const response = await crmApiFetch('/organizations/members/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: employeeCsvRows }),
      });
      const payload = await responseMessage(response);
      setEmployeeCsvNotice(`${payload.data.createdCount} employees were added to this workspace.`);
      setEmployeeCsvRows([]);
      setEmployeeCsvPreview([]);
      setEmployeeCsvFileName('');
      await load();
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : 'Could not import employees. No accounts were created.';
      await validateEmployeeCsv(employeeCsvRows);
      setEmployeeCsvError(errorMessage);
    } finally {
      setEmployeeCsvBusy(false);
    }
  }

  async function exportEmployees() {
    setEmployeeCsvBusy(true);
    setEmployeeCsvError('');
    try {
      const payload = await responseMessage(await crmApiFetch('/organizations/members/export'));
      const rows = (payload.data as Member[]).map((member) => [member.email, member.name, member.role, member.joinedAt]);
      downloadCsv('workspace-employees.csv', ['work_email', 'name', 'role', 'joined_at'], rows);
    } catch (caught) {
      setEmployeeCsvError(caught instanceof Error ? caught.message : 'Could not export employees.');
    } finally {
      setEmployeeCsvBusy(false);
    }
  }

  async function changeRole(member: Member, newRole: string) {
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      }));
      setNotice(`${member.name} is now assigned the ${roleLabel(newRole, workspaceRoles)} role.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this role.');
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}`, { method: 'DELETE' }));
      setNotice(`${member.name} was removed from the workspace.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this member.');
    }
  }

  async function transferOwnership(member: Member) {
    if (!window.confirm(`Transfer workspace ownership to ${member.name}? You will become an Admin.`)) return;
    setError('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/members/${member.userId}/transfer-ownership`, { method: 'PATCH' }));
      setNotice(`Ownership transferred to ${member.name}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not transfer ownership.');
    }
  }

  async function reviewRequest(joinRequest: MembershipRequest, decision: 'approve' | 'decline') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await responseMessage(await crmApiFetch(`/organizations/membership-requests/${joinRequest.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }));
      setNotice(`${joinRequest.name}'s request was ${decision === 'approve' ? 'approved' : 'declined'}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not review this request.');
    } finally {
      setBusy(false);
    }
  }

  function editModuleAccess(member: Member) {
    setEditingModulesFor(member);
    setModuleDraft(member.enabledModules.filter((module) => availableModules.includes(module)));
  }

  function toggleModule(module: string) {
    setModuleDraft((current) => current.includes(module)
      ? current.filter((value) => value !== module)
      : [...current, module]);
  }

  async function saveModuleAccess() {
    if (!editingModulesFor) return;
    setSavingModules(true);
    setError('');
    setNotice('');
    try {
      const payload = await responseMessage(await crmApiFetch(`/organizations/members/${editingModulesFor.userId}/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModules: moduleDraft }),
      }));
      setMembers((current) => current.map((member) => member.userId === editingModulesFor.userId
        ? { ...member, enabledModules: payload.data.enabledModules as string[] }
        : member));
      setNotice(`Module access updated for ${editingModulesFor.name}.`);
      setEditingModulesFor(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update employee module access.');
    } finally {
      setSavingModules(false);
    }
  }

  async function createEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingEmployee(true);
    setError('');
    setNotice('');
    try {
      const payload = await responseMessage(await crmApiFetch('/organizations/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEmployee),
      }));
      const created = payload.data as Member;
      setMembers((current) => [...current, created]);
      setNotice(`${created.reactivated ? 'Account reactivated' : 'Account created'} for ${created.name}. Share the sign-in email and initial password with them securely. Their account is linked to this workspace.`);
      setNewEmployee({ name: '', email: '', password: '', role: 'sales_rep' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the employee account.');
    } finally {
      setCreatingEmployee(false);
    }
  }

  const canManage = currentRole === 'owner' || currentRole === 'admin';
  return (
    <section className={styles.manager}>
      <header className={styles.heading}>
        <div><p className="date-label">WORKSPACE / TEAM</p><h1>Team & access</h1><p className="welcome-copy">Review join requests and manage your workspace members.</p></div>
      </header>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status">{notice}</div>}
      {!loading && !canManage && !error && <div className={styles.error} role="alert">Only the Organization Owner or Admin can manage members and invitations.</div>}

      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h2>Members</h2><p>{members.length} active in this workspace</p></div>{canManage && <button className="button button-secondary" type="button" onClick={() => void exportEmployees()} disabled={employeeCsvBusy}>Export employees CSV</button>}</div>
        {loading ? <p className={styles.empty}>Loading members…</p> : members.length === 0 ? <p className={styles.empty}>No members are available.</p> : (
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>MEMBER</th><th>EMAIL</th><th>ROLE</th><th>MODULE ACCESS</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
            <tbody>{members.map((member) => <tr key={member.userId}>
              <td><strong>{member.name}</strong></td>
              <td>{member.email}</td>
              <td>{member.role === 'owner' ? <span className={styles.roleBadge}>Owner</span> : <select aria-label={`Role for ${member.name}`} value={member.customRoleId ?? member.role} disabled={!canManage} onChange={(event) => void changeRole(member, event.target.value)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{workspaceRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>}</td>
              <td>{member.role === 'owner' || member.role === 'admin'
                ? <span className={styles.roleBadge}>All CRM modules</span>
                : <button type="button" className={styles.moduleAccessButton} onClick={() => editModuleAccess(member)}>{member.enabledModules.filter((module) => availableModules.includes(module)).length} modules · Manage</button>}</td>
              <td><span className={styles.verified}>Active</span></td>
              <td className={styles.actions}>{currentRole === 'owner' && member.role !== 'owner' && <button type="button" onClick={() => void transferOwnership(member)}>Transfer ownership</button>}{member.role !== 'owner' && <button type="button" className={styles.danger} disabled={!canManage} onClick={() => void removeMember(member)}>Remove</button>}</td>
            </tr>)}</tbody>
          </table></div>
        )}
        {editingModulesFor && canManage && <div className={styles.moduleAccessEditor} aria-label={`Module access for ${editingModulesFor.name}`}>
          <div><strong>CRM modules for {editingModulesFor.name}</strong><p>Choose the modules this employee can access. Team & access is reserved for CRM Admins.</p></div>
          <div className={styles.moduleAccessChoices}>
            {availableModules.map((module) => <label key={module}><input type="checkbox" checked={moduleDraft.includes(module)} onChange={() => toggleModule(module)} />{moduleLabels[module] ?? module}</label>)}
          </div>
          <div className={styles.moduleAccessActions}>
            <button type="button" className="button button-secondary" disabled={savingModules} onClick={() => setEditingModulesFor(null)}>Cancel</button>
            <button type="button" className="button button-primary" disabled={savingModules} onClick={() => void saveModuleAccess()}>{savingModules ? 'Saving…' : 'Save module access'}</button>
          </div>
        </div>}
      </section>

      {canManage && <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h2>Employee sign-in activity</h2><p>Recent employee login and logout times for this workspace.</p></div></div>
        {loading ? <p className={styles.empty}>Loading sign-in activity…</p> : sessionActivity.length === 0 ? <p className={styles.empty}>No employee sign-ins recorded yet.</p> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>EMPLOYEE</th><th>LOGGED IN</th><th>LOGGED OUT</th><th>DEVICE</th><th>STATUS</th></tr></thead><tbody>{sessionActivity.map((session, index) => <tr key={`${session.email}-${session.loginAt}-${index}`}><td><strong>{session.name}</strong><br />{session.email}</td><td>{new Date(session.loginAt).toLocaleString()}</td><td>{session.logoutAt ? new Date(session.logoutAt).toLocaleString() : 'Still active'}</td><td>{session.device}</td><td><span className={session.status === 'active' ? styles.verified : styles.pending}>{session.status === 'signed_out' ? 'Signed out' : session.status === 'expired' ? 'Expired' : 'Active'}</span></td></tr>)}</tbody></table></div>}
      </section>}

      {canManage && <>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Add employee manually</h2><p>Create an account with an active membership in this workspace. Employees sign in with their work email and password.</p></div></div>
          <form className={styles.csvImport} onSubmit={(event) => void createEmployee(event)}>
            <div className={styles.csvActions}>
              <label>Employee name<input required minLength={2} maxLength={100} autoComplete="name" value={newEmployee.name} onChange={(event) => setNewEmployee((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Work email<input required type="email" maxLength={254} autoComplete="email" value={newEmployee.email} onChange={(event) => setNewEmployee((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Initial password<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newEmployee.password} onChange={(event) => setNewEmployee((current) => ({ ...current, password: event.target.value }))} /></label>
              <label>Role<select value={newEmployee.role} onChange={(event) => setNewEmployee((current) => ({ ...current, role: event.target.value }))}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{workspaceRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              <button className="button button-primary" type="submit" disabled={creatingEmployee}>{creatingEmployee ? 'Creating account…' : 'Create employee account'}</button>
            </div>
            <p>The plan’s seat limit applies. Employee module access starts empty; assign permitted modules from the Members list.</p>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Employee onboarding by CSV</h2><p>Preview and validate work email, name, and password before adding accounts.</p></div></div>
          <div className={styles.csvImport}>
            <p>Required columns: <code>work_email</code>, <code>name</code>, <code>password</code>. Passwords are never shown in the preview or export.</p>
            <div className={styles.csvActions}>
              <a className="button button-secondary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(employeeCsvTemplate)}`} download="employee-template.csv">Download CSV template</a>
              <label className="button button-secondary">Choose employee CSV<input type="file" accept=".csv,text/csv" hidden disabled={employeeCsvBusy} onChange={(event) => { void chooseEmployeeCsv(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>
              {employeeCsvPreview.length > 0 && <button className="button button-primary" type="button" disabled={employeeCsvBusy || employeeCsvPreview.some(({ errors }) => errors.length > 0)} onClick={() => void importEmployees()}>{employeeCsvBusy ? 'Importing…' : `Import ${employeeCsvPreview.length} employees`}</button>}
            </div>
            {employeeCsvFileName && <p className={styles.csvFilename}>Selected: {employeeCsvFileName}</p>}
            {employeeCsvError && <p className={styles.error} role="alert">{employeeCsvError}</p>}
            {employeeCsvNotice && <p className={styles.notice} role="status">{employeeCsvNotice}</p>}
            {employeeCsvPreview.length > 0 && <div className={styles.csvPreview}>
              <strong>Preview: {employeeCsvPreview.filter(({ errors }) => errors.length === 0).length} valid of {employeeCsvPreview.length} rows</strong>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ROW</th><th>NAME</th><th>WORK EMAIL</th><th>VALIDATION</th></tr></thead><tbody>
                {employeeCsvPreview.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name || '—'}</td><td>{row.email || '—'}</td><td>{row.errors.length ? row.errors.join(' ') : 'Ready to import'}</td></tr>)}
              </tbody></table></div>
            </div>}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Lead onboarding</h2><p>Use the Leads area for manual creation, editing, search, filters, and archiving.</p></div><a className="button button-secondary" href="/leads">Open lead management</a></div>
          <div className={styles.csvImport}><LeadCsvImport compact onImported={(count) => setNotice(`${count} leads were imported into this workspace.`)} /></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><h2>Join requests</h2><p>{requests.length} waiting for workspace admin approval.</p></div></div>
          {requests.length === 0 ? <p className={styles.empty}>No pending requests.</p> : <ul className={styles.invitationList}>{requests.map((joinRequest) => <li key={joinRequest.userId}><div><strong>{joinRequest.name}</strong><span>{joinRequest.email} · Requested {new Date(joinRequest.requestedAt).toLocaleDateString()}</span></div><div className={styles.actions}><button type="button" disabled={busy} onClick={() => void reviewRequest(joinRequest, 'approve')}>Approve</button><button type="button" className={styles.danger} disabled={busy} onClick={() => void reviewRequest(joinRequest, 'decline')}>Decline</button></div></li>)}</ul>}
        </section>
      </>}
    </section>
  );
}
