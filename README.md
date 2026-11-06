# Myr CRM

A modular, multi-organization SaaS CRM. This repository follows the project
master prompt supplied in chat. Treat this README and `AGENTS.md` as the
persistent project context; keep the status and change log current after each
implementation change.

## Product and architecture

- Build a secure, responsive CRM for multiple organizations in one application.
- Use a strangler migration. The Next.js frontend and NestJS CRM API remain
  independently runnable. Do not describe the remaining API modules as
  independent services until their runtime and data ownership are extracted.
- Required stack: Next.js App Router, React, strict TypeScript, NestJS REST API
  under `/api/v1`, Prisma, PostgreSQL, and npm workspaces. Add Redis/BullMQ,
  email integration, and other infrastructure when their modules require them.
- Adapt to the existing repository layout. The web app is in `src/`; the API is
  in `apps/api/`.
- Build incrementally. A page is not complete until its API behavior,
  persistence, validation, authorization, tenant isolation, tests, and docs are
  handled. Never claim production readiness before the checks actually pass.

## Standing security and tenancy rules

- An organization is the tenant boundary. Every tenant-owned record must carry
  an organization ID.
- Derive the user ID from a verified server-side session. A body, query value,
  browser state, or organization ID alone never proves access.
- Treat the requested organization ID only as a selector. Verify the user's
  active membership for every protected request and scope all reads and writes
  to that verified organization.
- Validate that every related record and assignment target belongs to the same
  organization. A record ID alone is never sufficient authorization.
- Enforce permissions in the API. Deny by default, avoid mass assignment, and
  do not expose credentials, session secrets, or another tenant's data.
- Preserve historical records with archival/soft deletion where appropriate.
  Do not reset databases or create destructive migrations to fix problems.

## Developer ownership

This workspace is operating as **Developer 1**. Developer 1 owns Modules 1–8:

1. Authentication and security
2. Organization and multi-tenancy
3. User and role management
4. Dashboard data/API dependencies, coordinated with the dashboard owner
5. Leads
6. Contacts
7. Companies
8. Deals and pipelines

Developer 1 coordinates the initial database architecture and shared
authentication, tenant-isolation, and API contracts. Modules 9–15 (activities,
automation, email, reports, notifications, audit logs, and settings) belong to
Developer 2. Coordinate shared contracts when Developer 2 is available; owner-
approved work may proceed when they are unavailable, with assumptions recorded.

The initial roles are Organization Owner, Admin, Sales Manager, Sales
Representative, and Read-only User. The backend permission matrix is in
[`docs/architecture/role-permission-proposal.md`](docs/architecture/role-permission-proposal.md);
unresolved policy choices must remain visible rather than being silently
treated as agreed.

## Local development

Copy `.env.example` to `.env`, then start PostgreSQL and initialize the API
database:

```sh
docker compose up -d postgres
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
```

Start the web app with `npm run dev` and the API with `npm run api:dev` in
separate terminals. Email delivery is disabled. New workspace signups wait for
platform-admin approval; teammates create accounts, request workspace access
with a join code, and wait for an Owner/Admin to approve them. The web app proxies same-origin
`/api/v1` requests to the API server; set `API_PROXY_URL` when the API is not at
`http://localhost:4000/api/v1`. Useful checks:

```sh
npm run typecheck
npm run api:typecheck
npm run api:build
npm run api:test
npm test
npm run build
```

The local seed account is `maya@studionorth.co` / `password123`; never use it
outside local development. Database setup details and current API routes are in
[`apps/api/README.md`](apps/api/README.md).
The local-only `DEMO-CREDENTIALS.local.md` file also keeps these sign-in details
in this workspace and is excluded from Git.

## Current implementation status

The repository is in an incremental strangler migration and is not
production-ready. See
[`docs/architecture/service-decomposition.md`](docs/architecture/service-decomposition.md)
for the current service map, ownership, local workflow, and remaining migration.

- The web UI has dashboard and CRM module pages, sign-in/sign-up and account
  recovery forms, and a Team & access screen.
- The workspace dashboard now loads tenant-scoped lead, deal, and activity
  summaries and live deal/activity records through the authenticated API. It no
  longer presents hard-coded preview metrics as real CRM data.
- The NestJS API is the authenticated CRM gateway and still owns identity,
  organizations, memberships, CRM records, activities, automation, reports,
  notifications, audit logs, settings, billing, and the persisted email outbox.
- New public workspace signups are held for platform-admin approval. Teammates
  request access using a workspace join code; Owners/Admins review requests in
  Team & access, with in-app notifications and member details. No email
  delivery service or SMTP configuration is required.
- PostgreSQL/Prisma persistence covers users, organizations, memberships,
  expiring sessions, password-reset tokens, workspace join codes, notifications,
  and shared rate-limit buckets. Workspace-owner signup creates a pending
  Owner/workspace for platform review; teammate signup creates an account that
  can request access with a workspace join code. Organization selection is
  checked against active membership on protected API requests.
- Authentication includes per-route database-backed rate limits and HttpOnly
  SameSite session cookies (Secure in production) with same-origin checks on
  unsafe requests. Signup does not require email verification. Email delivery
  and password reset by email are currently disabled.
- The non-production seed provides the platform-admin login
  `admin@myrcrm.local` / `MyrAdmin123!` for `/control-panel`. Production does
  not create this demo account; configure `PLATFORM_ADMIN_EMAIL` with the
  address of one existing active account to grant platform-admin access.
  Customer workspace Owners/Admins remain separate and cannot access other
  workspaces' records or team details.
- Organization Owners and Admins can review teammate join requests, view and
  change member roles, remove members, and transfer ownership. Owner invariants
  are guarded transactionally and by a database partial unique index. Sales
  Managers get a tenant-scoped names-only assignee directory for team activities.
- Leads, contacts, companies, deals, and pipelines persist in PostgreSQL.
  Their queries, updates, and archives are organization-scoped; membership and
  composite foreign keys prevent cross-organization owner/creator and related
  record references. Company and deal CRUD is soft-archived, and pipelines
  support basic management of names and stages. The Companies and Deals
  screens use the API and are responsive.
- Activities are available at `/activities` and use the authenticated CRM API
  for organization-scoped persistence, related-record links, filtering, sorting,
  and pagination. The adopted MVP contract is documented in
  [`apps/api/README.md`](apps/api/README.md). The screen supports create, edit,
  completion/reopening, and archive. Managers can assign or unassign active team
  members; Sales Representatives are limited to self-assignment.
- Automation is available at `/automation`. Organization managers can create
  lead-triggered rules that create a linked follow-up task, pause/resume rules,
  archive them, and review successful run counts, last-run time, and recent
  successful runs. Rule execution is transactional with lead creation/status
  changes; assignment notifications are created in the same transaction. This
  owner-approved MVP has limited triggers/actions; see
  [`apps/api/README.md`](apps/api/README.md) for behavior and remaining policy
  assumptions.
- Email is available at `/email`. Users can compose plain-text messages for
  active contacts and view the organization-scoped outbox. Recipient addresses
  come from active contact records. Messages are saved as `not_configured` and
  are not delivered. Sales representatives are limited to their own contacts.
- Reports are available at `/reports` and show live, tenant-scoped summaries of
  lead status, deal outcomes and value, and activity status. Sales
  representatives see only their own leads and deals and assigned activities.
- Notifications are available in the top-bar inbox. The MVP persists a personal
  notification when another member assigns an activity or completes an activity
  created by the recipient, with unread counts and individual or bulk read
  actions. Email/push delivery and other event types are not included.
- Audit history is available at `/audit-logs` to Owners and Admins. It
  records successful API create/update/archive actions with actor, resource,
  and time, without copying request bodies. Read events are not recorded.
  Automation-generated tasks have a separate create event after the lead
  transaction commits. Audit writes are best-effort; failures are logged but do
  not roll back the completed CRM mutation.
- Settings are available at `/settings`. Owners and Admins can update the
  workspace name, currency display preference, time zone, and week start day;
  currency changes do not convert existing deal values. Settings has General,
  Leads, Roles, and Users sections; lead choices and workspace roles are
  documented as fixed until their customization APIs are implemented.
- New workspaces start pending and are directed to `/subscription` after sign-in.
  Owners/Admins can start one free two-day trial; after it expires, a plan
  activation request is queued for manual review in the platform control panel.
  Online checkout is not connected.
- The approved interim role matrix now governs organization member management,
  settings, audit access, and CRM record permissions. The Activities & Tasks
  module uses the adopted role and soft-archive contract.
- CRM email drafts are saved to the organization outbox but are not sent.
  Password reset by email is unavailable until delivery is restored. Set
  `TRUST_PROXY_HOPS` only when the API is behind that exact trusted proxy
  chain.

## Change log

Update this section whenever implementation changes are made. Include what
changed, checks actually run, and any important remaining limitation.

- 2026-11-06: Disabled outbound email delivery and removed the separate SMTP
  runtime. New workspace signups now await platform-admin approval; teammates
  register, request access with a workspace join code, and await workspace
  admin approval with in-app notifications. Validation pending.
- 2026-11-05: Integrated the Aditya and Akshat branch work on `mergetest`.
  Preserved the existing cookie-session, organization-membership, and
  tenant-scoped member APIs where branch changes overlapped; retained the
  non-overlapping settings, reporting, billing, dashboard, control-panel, and
  subscription work, including the demo verification opt-out, later removed
  when signup no longer required verification. Added additive subscription/platform-audit schema
  migrations. Verification: Prisma Client generation, API typecheck/build, 124 API tests,
  web typecheck, 16 web tests, Next production build passed. Database migrations were not
  applied because no database URL/service is configured. Other CRM capabilities
  remain in the NestJS modular monolith.
- 2026-10-31: Replaced the home dashboard's sample metrics, deal rows, and
  activities with tenant-scoped API data; added loading, empty, retry, and
  authentication states. Removed fabricated trend percentages and corrected
  stale preview labels. Checks were not run in this turn; a visual browser pass
  and the project checks remain outstanding.
- 2026-10-31: Finished backend integration for the Activities, Automation, and
  Email work: tenant-scoped assignment updates and notifications, automation
  run history and role enforcement, and SMTP-backed contact email delivery with
  persisted delivery states. Verification: API tests (78), web tests (16), API
  and web typechecks, API build, Prisma Client generation, and local migration
  deploy passed; all 11 migrations were already applied. SMTP delivery itself
  was not exercised against a configured mail provider.
- 2026-10-31: Added a creator notification when another member completes an
  activity and best-effort audit entries for automation-generated activities
  after the lead transaction commits. Added and applied the notification enum
  migration. Verification: 79 API tests, 16 web tests, API/web typechecks, API
  build, Prisma Client generation, and migration deploy passed. Live SMTP
  delivery remains unverified because SMTP is not configured.
- 2026-10-30: Improved mobile navigation so the menu overlays the page and closes
  from the backdrop or Escape, and fixed the Activities layout to stack its
  sidebar and content on phone-sized screens. Verification: all 16 web tests
  and frontend typecheck passed, as did the Next.js compile-mode build.
  Standard `next build` compiled but its worker was terminated during the
  TypeScript step; standalone typecheck passed.
- 2026-10-30: Refined the dashboard for narrow phones: increased mobile text and
  tap targets, compacted the top bar, and switched summary cards to a readable
  single-column layout below 420px. Frontend typecheck passed, and the live
  dashboard and generated mobile CSS returned HTTP 200 with the expected phone
  breakpoints. The focused Vitest worker exited before running tests; the
  compile-mode build was terminated by SIGTERM.

- 2026-10-30: Added live Reports, personal assignment Notifications, manager-only
  Audit Logs, and organization Settings APIs and UI. Added tenant-scoped
  persistence for notifications, audit events, and workspace preferences.
  Verification: 61 API tests, 15 web tests, API/web typechecks and builds,
  Prisma validation/client generation, local migration deployment, and
  authenticated `200` smoke checks for all four APIs through the web proxy.
  At that point notifications covered activity assignments only, audit entries
  omitted service-side automation effects, and role policy remained provisional.

- 2026-10-29: Added the Email outbox MVP: tenant-scoped messages to active
  contacts, role/ownership checks, outbox pagination/search, and responsive
  compose/history UI. No provider is configured, so the API/UI state that no
  email is sent. Verification: 50 API tests, 8 UI tests, API/web typechecks and
  builds, Prisma validation and client generation. Migration application was
  not run because no local `DATABASE_URL` is configured.

- 2026-10-29: Added the Automation MVP: organization-scoped rules trigger on
  lead creation or a selected lead status and create linked follow-up tasks;
  managers can manage rules and inspect successful run counts and last-run
  times. Verified with 44 API tests, 6 UI tests, API/web typechecks, API/web
  builds, and a local API smoke test. Role access remains provisional pending
  shared-contract review.
- 2026-10-31: Completed the Automation MVP integration: role-gated rule
  management, visible per-rule run history, and transactional notifications
  when automation assigns a follow-up task to another member. Adopted the
  interim role matrix for automation permissions and updated the contract docs.
- 2026-10-31: Connected the Email outbox to the shared SMTP transport. Messages
  send synchronously when SMTP is configured and record sent/failed status;
  otherwise they remain saved as not configured. Updated the composer and
  outbox to show delivery state. Automatic retries remain out of scope.

- **2026-10-28:** Added Prisma/PostgreSQL identity tables and migration, persisted
  signup/login/logout sessions, membership-checked tenant context, organization
  list/create endpoints, local PostgreSQL Compose setup, and first API unit
  tests. Root and API typechecks and the API build passed; Prisma schema
  validation passed; all 3 API unit tests passed after rerunning outside the
  sandbox. Database migration application could not be exercised because the
  container has no Docker daemon. CRM record persistence is still in memory.
- **2026-10-28:** Migrated leads and contacts to Prisma/PostgreSQL, added tenant
  composite foreign keys, archive/search/filter/sort/pagination behavior,
  contact-email uniqueness per organization, deterministic local seed records,
  and API unit coverage for tenant scope and server-controlled ownership.
- **2026-10-28:** Added tenant-scoped company persistence and CRUD endpoints,
  soft archival, search/sort/pagination, server-controlled ownership, seeded
  local company records, and API unit coverage. Prisma schema validation,
  Prisma client generation, API typecheck/build, and all 6 company tests passed.
- **2026-10-28:** Fixed contact creation with omitted optional fields. Added
  tenant-scoped deals and pipelines with stage membership validation, a default
  pipeline for new/existing organizations, responsive API-backed Companies and
  Deals screens, local sample deals, a public health route, and API tests.
  Prisma schema validation/generation, API and web typechecks/builds, all 24 API
  tests, local migration deployment, and seeded API login/list requests passed.
  The web preview is running at `http://localhost:3000`; local API runs on
  port 4001 for this preview. Activities remain without an API.

- **2026-10-28:** Fixed browser-to-API connectivity for hosted/forwarded previews
  by proxying same-origin `/api/v1` requests through Next.js. Sign-in, sign-up,
  and CRM requests now use the same API client; configure the server-side
  `API_PROXY_URL` instead of exposing a browser-local API URL.
- **2026-10-29:** Integrated the shared CRM foundation from `main` and moved the
  Activities sample UI to `/activities` so it no longer replaces the shared
  dashboard. The Activities screen remains demo-only pending shared API,
  authentication, tenancy, and contract coordination.
- **2026-10-29:** Added a persisted, tenant-scoped Activities API and connected
  the `/activities` screen through `crmApiFetch`, including linked-record
  validation, API-backed filters and pagination, completion/archive actions,
  and manager-only team assignee selection. Archive semantics remained pending
  shared-contract review at that time.
- **2026-10-31:** Completed the Activities & Tasks MVP: added edit support,
  activity type and priority filters, assignment-change notifications, and
  consistent UI permissions. Adopted soft archive and the interim role matrix
  as the module contract; updated architecture and API documentation.



## Next session

- Preview web/API servers are running at `http://localhost:3000` and port
  `4000`; PostgreSQL and local seed data remain available.
- The same-origin API proxy was verified for login and the Reports,
  Notifications, Audit Logs, and Settings endpoints. Sign in with the
  local-only credentials in `DEMO-CREDENTIALS.local.md`.
- Before deploying this approval flow, apply the database migration and update
  Render's API start command to `npm run start --workspace @myr-crm/api`.
  Deploy only the API and web services; no email service or SMTP setup is
  needed.
