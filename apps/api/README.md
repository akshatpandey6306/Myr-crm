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

## Authentication and account recovery

The web app provides `/sign-in`, `/sign-up`, `/forgot-password`,
`/reset-password`, and `/verify-email`. Signup creates the user, workspace,
Owner membership, and default pipeline atomically, then sends a verification
link; login is refused until the email is verified. The API exposes
`POST /api/v1/auth/signup`, `POST /api/v1/auth/login`,
`POST /api/v1/auth/logout`, `GET /api/v1/auth/me`,
`POST /api/v1/auth/password-reset/request`,
`POST /api/v1/auth/password-reset/confirm`,
`POST /api/v1/auth/email-verification/resend`, and
`POST /api/v1/auth/email-verification/confirm`.

Login sets a seven-day `myr_session` HttpOnly, SameSite=Lax cookie, with Secure
enabled in production. The API stores only the SHA-256 session digest and accepts
that cookie for protected requests; the raw session token is never returned in
JSON or stored in browser storage. Unsafe requests with an Origin header must
match `WEB_ORIGIN`, and production cookie-authenticated mutations require the
expected Origin. Password-reset and verification tokens are random, one-use
values stored only as SHA-256 digests; reset links expire after one hour and
verification links after 24 hours. Successful password resets revoke every
existing session for that user. Reset and resend responses are generic to avoid
account enumeration.

Authentication and invitation endpoints use PostgreSQL-backed rate-limit
windows keyed by hashed IP and, where applicable, normalized email or user ID.
Limits are 10 login attempts per 15 minutes; 5 signup and verification-resend
attempts per hour; 5 reset requests per hour; 10 reset/verification/invitation
accept attempts per hour; and 20 invitations per hour per inviter/email.
Expired buckets are periodically removed by the API.

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and optional `SMTP_USER` /
`SMTP_PASSWORD` in `.env` to deliver verification, reset, invitation, and CRM
contact messages. TLS is required by default for STARTTLS connections; use
`SMTP_SECURE=true` for implicit TLS. In development without SMTP, one-time
links are logged locally; production startup fails when `SMTP_HOST` or
`SMTP_FROM` is missing. SMTP delivery is synchronous and does not retry.

`GET /api/v1/organizations` lists the caller's active memberships and
`POST /api/v1/organizations` creates another workspace with the caller as
Owner. Organization IDs in `x-organization-id` select a tenant only after the
API verifies the caller's active membership. The Next.js app proxies browser
requests through its own `/api/v1` origin. Set `API_PROXY_URL` on the web
server if the API is not at `http://localhost:4000/api/v1`; set `WEB_ORIGIN` to
the web app origin when it differs from `http://localhost:3000`.

The API rate limiter uses Express `request.ip`. Set `TRUST_PROXY_HOPS` to the
exact trusted reverse-proxy hop count when deployed behind a proxy, and ensure
the API cannot be reached directly by untrusted clients that can spoof
`X-Forwarded-For`.

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

## Team, invitations, and roles

`GET /api/v1/organizations/members` lists active members (including email and
verification status) for Owners and Admins. `PATCH
/api/v1/organizations/members/:userId` changes a member to Admin, Sales Manager,
Sales Representative, or Read-only User; only Owners and Admins may manage
members. Owners cannot be changed through this endpoint. Only the current Owner
can transfer ownership with `PATCH
/api/v1/organizations/members/:userId/transfer-ownership`; the previous Owner
becomes an Admin. Members can be removed with `DELETE
/api/v1/organizations/members/:userId`. Owner uniqueness and transfer are
protected by a transaction and a database partial unique index.

Owners and Admins can invite with `POST /api/v1/organizations/invitations`,
list pending invitations with `GET` on the same route, and revoke with
`DELETE /api/v1/organizations/invitations/:id`. Invitations expire after seven
days and store only a token hash. `POST
/api/v1/organizations/invitations/accept` accepts a one-time email link; a new
member sets a name and password, while an existing account is added to the
organization. Accepting an invite verifies the invited email and creates the
membership and audit event transactionally. A names-only active member
directory at `GET /api/v1/organizations/assignees` is available to Owners,
Admins, and Sales Managers for activity assignments.

The interim role matrix is approved for the MVP and documented in
[`../../docs/architecture/role-permission-proposal.md`](../../docs/architecture/role-permission-proposal.md).
Owners/Admins alone manage members, workspace settings, and audit history.
Sales Managers retain pipeline, activity assignment, automation, and
organization-wide sales-record management. Sales Representatives read/update
their own records and cannot archive or reassign. Read-only Users cannot mutate
CRM records.

## Activities and tasks — adopted MVP contract

The Activities screen at `/activities` uses `GET /api/v1/activities`,
`POST /api/v1/activities`, `GET /api/v1/activities/:id`,
`PATCH /api/v1/activities/:id`, and `DELETE /api/v1/activities/:id`.
Requests use the shared HttpOnly session cookie and `x-organization-id`; the API verifies
active membership and scopes records to that organization.

Activity fields are `id`, `organizationId`, `type`, `title`, `description`,
`status`, `priority`, `dueAt`, `completedAt`, `assignedToUserId`,
`relatedToType`, `relatedToId`, `createdByUserId`, `createdAt`, and
`updatedAt`. Responses also include `assignedToName`, `relatedToName`, and
`createdByName`. Types are `task`, `call`, `meeting`, `note`, and `email`;
statuses are `open`, `in_progress`, `completed`, and `cancelled`; priorities
are `low`, `normal`, and `high`. The server controls organization, creator, and
timestamps. A completed status sets `completedAt`; reopening clears it.

The list accepts `q`, `type`, `status`, `priority`, `assignedToUserId`,
`relatedToType`, `relatedToId`, `page`, `pageSize`, `sortBy`, and `sortOrder`.
Pagination defaults to page 1 and pageSize 25 (maximum 100). Sort fields are
`createdAt` and `dueAt`; sort order is `asc` or `desc`. Lists return
`{ data: [...], meta: { page, pageSize, total, totalPages } }`; single-record
routes return `{ data: ... }`; errors use
`{ error: { code, message, details } }`. Related-record type and ID must be
provided together, and active lead, contact, company, and deal references are
validated against the selected organization. Assignees must be active members
of that organization. Owners, Admins, and Sales Managers can choose an active member in
the UI; Sales Representatives are limited to self-assignment.

The MVP contract uses soft archive for `DELETE`, consistent with other CRM
records. The Owner-approved role matrix applies: Owner, Admin, and Sales
Manager can read, create, update, assign, and archive organization activities;
Sales Representatives can read and update assigned activities and create
activities assigned to themselves, but cannot reassign or archive; Read-only
Users can read. Assignment changes notify the new assignee. The `/activities`
screen supports create, edit, completion/reopening, archive, filtering, search,
sorting, and pagination. Managers can assign or unassign active organization
members; Representatives create activities assigned to themselves.

## Automation — owner-approved MVP

Rules use `GET/POST /api/v1/automations`, `PATCH /api/v1/automations/:id` to
pause/resume, `DELETE /api/v1/automations/:id` to soft-archive, and
`GET /api/v1/automations/:id/runs` for the latest successful executions. Every
query and mutation is scoped to the verified organization. All active members
can read rules and runs; only Organization Owners, Admins, and Sales Managers
can create, pause, resume, or archive rules.

All active organization members can read rules and successful run history.
Only Owners, Admins, and Sales Managers can create, pause, resume, or archive
rules, following the approved interim role matrix.

A rule supports one trigger (`lead_created` or `lead_status_changed`) and one
action: create a linked `task` activity. A status-change trigger requires a
lead status. The activity title can contain `{{leadName}}`; the task uses the
configured priority and due offset (0–365 days), is assigned to the lead owner,
and is linked to that lead. Each rule runs at most once per lead. Lead writes,
generated tasks, and successful run records share one database transaction, so
an automation failure rolls back the triggering lead write as well.
Run history is available per rule and the UI displays the latest 50 successful
runs. If a generated task is assigned to another member, that member receives
an activity assignment notification in the same transaction.

This MVP uses synchronous lead-created and lead-status-changed triggers and
creates linked tasks. Run history stores successful executions only. Delete
uses soft archive. Scheduled, email, deal, retry, and failure-history
workflows are outside this MVP contract.

## Email outbox and SMTP delivery

The Email screen at `/email` uses `GET /api/v1/emails` to list messages and
`POST /api/v1/emails` to save a plain-text message. Requests use the shared
HttpOnly session cookie and verified organization context. The create body contains
`contactId`, `subject`, and `body`; the recipient name and address are copied
from an active contact on the server, so clients cannot substitute an address.
Subjects are single-line and limited to 255 characters; message bodies are
limited to 20,000 characters.

The list accepts `q`, `page`, and `pageSize` (default 1 / 25, maximum 100) and
returns `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
Organization Owners, Admins, and Sales Managers can view the organization's
outbox. Sales Representatives can view and compose messages only for their own
contacts; Read-only Users can view but cannot compose.

When SMTP is configured with `SMTP_HOST` and `SMTP_FROM`, the API sends the
message synchronously after storing the outbox record. Successful delivery is
recorded as `sent` with `sentAt`; a delivery error is recorded as `failed`.
Without SMTP, messages are saved as `not_configured` and are not delivered.
Message bodies are plain text and the recipient address always comes from the
selected active contact. The UI shows each message's delivery state.

Delivery has no retry queue: configure SMTP as described in Authentication and
Security. A process or database failure after SMTP accepts a message can leave
delivery state uncertain; a future worker with idempotent delivery is needed
before retrying automatically. Templates, attachments, and inbound mailbox
sync are outside this MVP.

## Reports — live summary

`GET /api/v1/reports/summary` returns organization-scoped totals for active
leads, deals grouped by outcome and value, and activities grouped by status,
including open pipeline value and won revenue. Sales Representatives are
restricted to leads/deals they own and activities assigned to them; other
members see the organization summary. The `/reports` screen refreshes from this
endpoint. Report exports, saved report definitions, and scheduled delivery are
not included.

## Notifications — activity assignments and completion

`GET /api/v1/notifications?limit=20` returns the signed-in member's recent
notifications and unread count. `PATCH /api/v1/notifications/:id/read` marks
one notification read; `POST /api/v1/notifications/read-all` marks that
member's unread notifications read. Every query is scoped to the verified
organization and recipient. Creating or reassigning an activity to another
member creates an `activity_assigned` notification in the same transaction.
Completing an activity created by another member creates an
`activity_completed` notification for its creator in the same transaction.
The top-bar inbox shows both event types; email/push delivery and configurable
notification preferences are not included.

## Audit logs — mutation history

`GET /api/v1/audit-logs` returns paginated events for the verified organization
and is limited to Owners and Admins. A global API interceptor
records successful create, update, and archive requests as action, resource
type/ID, actor, and timestamp. Request bodies and read events are not stored;
authentication, health, and notification routes are excluded. Automation-
generated activities receive a separate create event after the lead transaction
commits. Audit persistence is best-effort: a failed audit insert is logged by
the API but does not roll back the completed CRM mutation. The `/audit-logs`
screen displays the history.

## Organization settings

`GET /api/v1/settings` returns the selected organization's name and preferences,
with defaults when none have been customized. `PATCH /api/v1/settings` allows
Owners and Admins to update `organizationName`, `currency`
(`USD`, `CAD`, `EUR`, or `GBP`), `timezone`, and `weekStartsOn` (0–6). All
settings are organization-scoped and unknown fields are rejected. The currency
is a display preference and does not convert stored deal values. The `/settings`
screen disables editing for other roles.

## Leads preview

Leads are scoped to the authenticated user's active organization. Requests use
the HttpOnly session cookie established by sign-in; `x-organization-id` may select an
organization only when the user is a member of it. The list endpoint accepts
`q`, `source`, `status`, `page`, `pageSize`, `sortBy`, and `sortOrder`. Create,
update, and archive use
`POST /api/v1/leads`, `PATCH /api/v1/leads/:id`, and
`DELETE /api/v1/leads/:id`. Deletion archives a lead, and archived leads are
excluded from the active list. Contacts use matching CRUD routes under
`/api/v1/contacts`, with `q`, pagination, and sorting on the list route.
