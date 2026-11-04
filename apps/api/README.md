# CRM API

The API is a standalone NestJS workspace. Its routes use the `/api/v1` prefix.

From the repository root, create the local database and copy `.env.example` to
`.env`:

```sh
docker compose up -d postgres
cp .env.example .env
npm run db:generate
npm run db:deploy
npm run db:seed
```

For a new local migration, use `npm run db:migrate` after editing
`apps/api/prisma/schema.prisma`. Commit the generated migration folder. Do not
run reset commands against a shared or production database.

Then start the applications:

```sh
npm run api:dev
npm run api:typecheck
npm run api:build
```

The API listens on port `4000` by default. Set `PORT` to use a different port.
`GET /api/v1/health` is an unauthenticated liveness check. Protected CRM routes
require a persisted session and a verified organization membership.

## Authentication preview

The web app provides `/sign-in`, `/sign-up`, `/verify-email`, and
`/forgot-password`. The API exposes login, signup, logout, refresh,
password-reset, and email-verification routes under `/api/v1/auth`. Signup
creates an owner membership for the new workspace and persists the user,
organization, owner membership, access session, and refresh token in PostgreSQL.
Only token hashes are persisted. Access cookies expire after 15 minutes and
rotating refresh cookies after 30 days. Browser cookies are HttpOnly and
SameSite=Lax; cookie-authenticated mutations require the configured
`WEB_ORIGIN`. Bearer API clients can request/rotate refresh tokens by sending
`X-API-Client: bearer` at login/signup and supplying the returned refresh token
to `/auth/refresh`. Configure `EMAIL_API_KEY` and `EMAIL_FROM` for Resend
delivery. Production workspace access requires verified email. Authentication
throttles are stored in PostgreSQL and shared across API instances.
`GET /api/v1/organizations`
lists the caller's active memberships and
`POST /api/v1/organizations` creates another workspace with the caller as owner.
Organization IDs in `x-organization-id` select a tenant only after the API
verifies the caller's active membership. The Next.js app proxies browser
requests through its own `/api/v1` origin to avoid browser-host and CORS issues.
Set `API_PROXY_URL` on the web server if the API is not at
`http://localhost:4000/api/v1`. Set `WEB_ORIGIN` to the web app origin when it
differs from `http://localhost:3000`.

The authentication migration adds shared rate-limit buckets and refresh-token
storage. Apply it with `npm run db:deploy` before starting the updated API.

New workspaces start with a pending subscription and cannot access CRM data
until a plan is active. Set `BILLING_TEST_MODE=true` for local development to
let workspace owners start one no-charge, 2-day test trial. This setting is
ignored in production. The internal control panel lists each workspace owner
and subscription, and platform admins can activate a manual 30-day plan, expire
a plan, or suspend workspace access. PayU checkout, payment verification, and
webhooks are not connected. The subscription page identifies PayU but does not
accept payment; manual platform-admin activation remains the only paid-plan
activation workflow until a PayU product/region and credentials are configured
and the integration is separately implemented and approved.

When a trial expires, workspace members are sent to the subscription page,
which displays each active plan's configured price and billing interval.
Online checkout is not available yet, so the platform team must manually
activate a paid plan. Allowlisted platform administrators are exempt from the
workspace subscription gate and are sent to the control panel.

`GET /api/v1/organizations/members` lists active members of the selected,
verified organization. It returns each member's `id`, `name`, and organization
`role`, email, and whether the row is the current user. Owners and Admins can
invite/revoke invitations, change member roles with
`PATCH /api/v1/organizations/memberships/:id/role`, and remove eligible
members. Only the Owner can transfer ownership with
`POST /api/v1/organizations/transfer-ownership`; the previous Owner becomes an
Admin. Owner removal or direct role edits are blocked, and ownership transfers
and member/invitation changes are audited. The Owner account is protected from
Admin changes; Admins cannot change their own role. These rules follow the
interim policy in
[`docs/architecture/role-permission-proposal.md`](../docs/architecture/role-permission-proposal.md)
and should be reviewed with Developer 2 before policy is considered final.
Individual record modules continue to enforce their own assignment permissions
and verify assignment targets belong to the active organization.

## Activities

 and  manage tenant-scoped activities. Fields: type (task, call, meeting, note, email), title, description, status (open, in_progress, completed, cancelled), priority (low, normal, high), dueAt, assignedToUserId, relatedToType, relatedToId. Related records and assignment targets are validated against the active organization. completedAt is set when status becomes completed and cleared when reopened.

## Internal control panel

Set `PLATFORM_ADMIN_EMAILS` to a comma-separated allowlist of internal staff
emails on the API server. The authenticated account must be active and match
this allowlist to access `/control-panel`. The web UI is at `/control-panel`;
it lists workspace owners, member counts, subscription plans, and end dates.
Internal staff can manually activate a 30-day plan, expire a subscription, and
suspend or restore workspace access. A suspended organization is blocked by
the API organization guard, including for members with otherwise valid
sessions. Keep the allowlist restricted to trusted internal accounts.

An expired workspace can be reactivated from the control panel with any
available plan. Selecting a plan and activating it starts a new manual
30-day subscription; changing an active workspace's plan also starts a new
30-day period. These manual changes do not charge customers.

For local testing only, `npm run db:seed` creates
`admin@myrcrm.local` with password `MyrAdmin123!`. Add
`PLATFORM_ADMIN_EMAILS=admin@myrcrm.local` to your local `.env`, restart the
API, then sign in and open `/control-panel`. This seeded credential is public
test data: never use it outside a local development database or allowlist it
in a shared or production environment.

The billing API offers Starter, Growth, and Business plan definitions and a
local-only 2-day test trial. Trial activation grants CRM access without
collecting payment. PayU checkout, payment verification, and webhooks have not
been implemented; no payment is collected through the subscription page.

## Control Panel Improvements

**Status: implemented.** The existing platform-admin control panel was enhanced
in place; onboarding, owner/member details, manual subscription and access
controls, plan management, and audit history remain available.

### Existing features preserved

| Existing capability | Current behavior | Preserved behavior |
| --- | --- | --- |
| Workspace onboarding | Creates a workspace, its owner account, and optionally an initial plan. | The existing form and workflow remain available in the main panel, with its fields and purpose intact. |
| CRM administrator details | Lists the workspace owner and can expand active members to see names, emails, and roles. | Owner details and the expandable member directory remain available; the overview does not expose additional customer records. |
| Employee/member counts | Shows active member counts. Plan employee limits are stored and enforced when adding members. | The table retains expandable active-member details and shows seats used against the assigned plan limit, including unexpired invitations. |
| Workspace and subscription controls | Shows creation date, access status, plan, subscription status/end date; supports suspend/restore, manual activation/extension, expiry/cancellation, and module access changes. | Every existing action remains available. Sensitive changes capture a reason, and manual changes remain clearly distinguished from payments. |
| Plan management | Platform administrators can create/edit/deactivate plans, including price, interval, trial, features, and employee limit. Platform administrators are exempt from customer subscriptions. | The existing plan editor and controls remain available. Plan prices are not represented as collected payments, and metadata-only usage limits are not represented as enforced. |
| Summary and audit log | Shows tenant/subscription summary cards and recent administrative actions, including actor, target, metadata, and time. | Both summary and audit sections remain available. Audit filtering is limited to the latest 50 loaded entries, which are not presented as a complete history. |
| Access protection | The authenticated, active platform-admin account must match `PLATFORM_ADMIN_EMAILS`; control-panel API routes use `PlatformAdminGuard`. | Backend authorization remains enforced. Sensitive mutations continue to be audited. |

### Delivered changes

1. Added in-page section navigation and responsive tenant filters for CRM
   administrator, access state, subscription state, plan, and signup date.
   Administrator search returns matching organization IDs only; it does not
   expose additional member details in the organization overview.
2. Added seat usage using active memberships plus unexpired invitations, the
   same counts used by the API to enforce employee limits. The UI distinguishes
   active members, pending invitations, unavailable plan limits, and
   organizations at/over their configured seat limit.
3. Improved recent audit search/action filtering, displays audit reasons, and
   labels that only the latest 50 entries are loaded.
4. Sensitive workspace access, subscription, and module changes now require a
   non-empty reason (up to 500 characters); the reason is recorded in the
   existing audit-log `reason` field. The platform-admin authorization guard
   remains on these API routes.
5. Added a PayU wordmark and an explicit "payments not configured" notice to
   the pending/expired subscription view. This is branding only: it does not
   accept or verify payments. Platform administrators continue to manage plans
   and manually activate subscriptions; they do not need a customer plan.
6. Kept the existing loading, error, empty, onboarding, owner/member, plan,
   access, module, and audit workflows.

### Data gaps and out-of-scope items

- Organizations have active/suspended states, but no archive state or archive
  workflow.
- There is no durable subscription/payment ledger, invoice history, payment
  status, or completed payment-provider integration. `billingProvider` alone
  does not establish that a payment succeeded. Do not report revenue,
  conversions, failed payments, or overdue invoices as facts.
- Onboarding creates the workspace and owner, but no onboarding-progress
  lifecycle is stored. There are no reliable storage-usage measurements,
  last-activity/login signal, support-request/notes workflow, background-job
  monitoring, queue/backup/maintenance signals, or usage trends.
- The health endpoint currently reports only API liveness (`{"status":"ok"}`);
  it does not establish database or dependency health.
- Platform-admin access is configured by environment allowlist; there is no
  in-product platform-admin role-management workflow. Enabled CRM modules are
  tenant module access controls, not service-wide feature flags.
- There is no impersonation or export workflow. These should not be added as
  incidental UI changes.

### API, authorization, and payment behavior

- `GET /api/v1/control-panel/organizations` includes active member and pending
  invitation counts. `GET
  /api/v1/control-panel/organizations/admin-search?q=...` returns only IDs for
  workspaces where an active Owner/Admin account matches the search.
- The control-panel routes remain protected by the active-account and
  `PLATFORM_ADMIN_EMAILS` platform-admin guard.
- The access, subscription, and module `PATCH` routes require a reason and
  persist it with the actor, target, and timestamp in the audit log.
- The PayU wordmark is not a payment integration. The PayU product/region and
  merchant credentials have not been supplied; checkout, server-side
  verification, webhooks, and self-service activation remain deferred.

No schema migration, payment dependency, credential, or infrastructure was
added for these improvements. A real PayU integration will require the exact
merchant product/region, credentials, server-side payment verification, and any
needed payment-reference storage; it must be separately planned and approved.

`GET /api/v1/dashboard/summary` returns organization-scoped lead and deal
metrics, open deal value by pipeline stage, and the five most recently created
open deals. Sales Representatives see only records they own. Activity history
and upcoming tasks are provided by the Activities module and are not included
in this response.

The seed account is `maya@studionorth.co` with password `password123`; it and
the sample leads/contacts are for local development only. Leads and contacts
are persisted in PostgreSQL and scoped by the verified organization. Their
list endpoints accept `page` (default 1), `pageSize` (default 25, maximum 100),
and supported `sortBy`/`sortOrder` values, and return pagination metadata.
Contact emails are unique within an organization, including archived contacts.
Companies are persisted in PostgreSQL and use tenant-scoped CRUD routes at
`/api/v1/companies`. The list route supports `q`, `page`, `pageSize`,
`sortBy` (`createdAt`, `name`, or `industry`), and `sortOrder`; records can be
updated with `PATCH /api/v1/companies/:id` and archived with
`DELETE /api/v1/companies/:id`. The company fields are `name` (required),
`industry`, `website`, and `phone`; ownership and organization are derived from
the authenticated request. As with leads and contacts, company records are
restricted to the verified organization and representative-owned records.

## Deals and pipelines

Every organization receives a default Sales pipeline with Discovery, Qualified,
Proposal, and Negotiation stages. `GET /api/v1/pipelines` lists the pipelines
and their stages. Managers (Owner, Admin, or Sales Manager) can create a
pipeline with `POST /api/v1/pipelines`, rename one with
`PATCH /api/v1/pipelines/:id`, or append a stage with
`POST /api/v1/pipelines/:id/stages`.

Deals use `/api/v1/deals` for tenant-scoped list, create, get, update, and
archive operations. Lists support `q`, `pipelineId`, `status`, pagination, and
sorting. Deal fields include `name`, `value`, `closeDate`, `status`,
`companyId`, `pipelineId`, and `stageId`; the API verifies company, pipeline,
and stage membership in the active organization. Deletion archives a deal.

## Leads preview

Leads are scoped to the authenticated user's active organization. Browser
requests use the HttpOnly session cookie; bearer tokens remain supported, and
`x-organization-id` may select an organization only when the user is a member
of it. The list endpoint accepts
`q`, `source`, `status`, `page`, `pageSize`, `sortBy`, and `sortOrder`. Create,
update, and archive use
`POST /api/v1/leads`, `PATCH /api/v1/leads/:id`, and
`DELETE /api/v1/leads/:id`. Deletion archives a lead, and archived leads are
excluded from the active list. Contacts use matching CRUD routes under
`/api/v1/contacts`, with `q`, pagination, and sorting on the list route.
