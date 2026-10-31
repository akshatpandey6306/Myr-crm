# Myr CRM

A modular, multi-organization SaaS CRM. This repository follows the project
master prompt supplied in chat. Treat this README and `AGENTS.md` as the
persistent project context; keep the status and change log current after each
implementation change.

## Product and architecture

- Build a secure, responsive CRM for multiple organizations in one application.
- Use a modular monolith. Keep the Next.js frontend and NestJS API independently
  runnable; add a separate worker only when queued work is introduced.
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
Developer 2. Do not independently implement those modules; coordinate shared
contracts when Developer 2 is available. If Developer 2 is unavailable, keep
work within Developer 1's ownership and document cross-module assumptions.

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
separate terminals. The web app proxies same-origin `/api/v1` requests to the
API server; set `API_PROXY_URL` when the API is not at
`http://localhost:4000/api/v1`. Useful checks:

```sh
npm run typecheck
npm run api:typecheck
npm run api:build
npm run api:test
```

The local seed account is `maya@studionorth.co` / `password123`; never use it
outside local development. Database setup details and current API routes are in
[`apps/api/README.md`](apps/api/README.md).
The local-only `DEMO-CREDENTIALS.local.md` file also keeps these sign-in details
in this workspace and is excluded from Git.

## Current implementation status

The repository is in an early MVP foundation stage, not production-ready.

- The web UI has dashboard and sample module pages plus sign-in/sign-up forms.
- The NestJS API has health, authentication, organizations, organization-member
  listing, internal control-panel, billing/subscription, dashboard summary, leads, contacts,
  companies, deals, and pipeline routes.
- PostgreSQL/Prisma persistence currently covers users, organizations,
  memberships, subscriptions, and expiring sessions. Signup creates the initial
  Owner membership and an unlicensed workspace atomically. Subscription status
  and expiry are checked along with organization membership on protected API
  requests. Local test mode offers one no-charge 2-day trial; Razorpay checkout
  is not connected yet.
- Leads, contacts, companies, deals, and pipelines persist in PostgreSQL.
  Their queries, updates, and archives are organization-scoped; membership and
  composite foreign keys prevent cross-organization owner/creator and related
  record references. Company and deal CRUD is soft-archived, and pipelines
  support basic management of names and stages. The Companies and Deals
  screens use the API and are responsive. Activities still have no API or
  durable persistence.
- The dashboard metrics, pipeline distribution, and recent open deals use a
  tenant-scoped API summary. Recent activity and upcoming tasks remain
  placeholders for the Activities module.
- Browser authentication now uses an HttpOnly, SameSite=Lax session cookie while
  bearer tokens remain supported for API clients. Password reset,
  email-verification, invitation, rate-limiting, refresh-token, and full
  permission-administration flows remain outstanding.
- Organization-specific role policy and the shared Developer 2 contracts still
  need review when that developer is available.
- Internal platform administrators can view customer workspaces and suspend or
  restore CRM access, review onboarding owners and subscription dates, and
  manually activate or expire plans. Configure `PLATFORM_ADMIN_EMAILS` in the
  API environment. The local seed creates `admin@myrcrm.local` /
  `MyrAdmin123!` for testing only; never use or allowlist this account outside
  a local development database.
- Workspaces without an active subscription are redirected to plan selection,
  and subscription expiry is enforced by protected API routes. Local
  `BILLING_TEST_MODE=true` allows one no-charge 2-day test trial, with a
  header expiry warning during its final day. Razorpay checkout, verification, and
  webhooks are not connected, so the displayed plan prices are not being
  charged.

## Change log

Update this section whenever implementation changes are made. Include what
changed, checks actually run, and any important remaining limitation.

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
- **2026-10-29:** Added a verified-organization endpoint for listing active
  members by ID, name, and role, without exposing email addresses. API docs and
  unit tests cover tenant scoping and required organization context.
- **2026-10-29:** Added a tenant-scoped dashboard summary for lead/deal metrics,
  open deal values by stage, and recent open deals. Replaced demo dashboard
  CRM records with API data and made unimplemented Activities sections explicit
  placeholders. Hardened the API error filter to avoid returning internal
  server exception details. API tests, typechecks, and frontend/API builds pass.
- **2026-10-29:** Added HttpOnly, SameSite=Lax browser session cookies on
  signup/login and cookie-based authentication/logout while retaining bearer
  token compatibility for other clients.
- **2026-10-29:** Fixed Deals UI error reporting for non-JSON API/proxy failures
  and confirmed pipeline, company, deals, dashboard, and member API requests
  through the same-origin proxy with local credentials.
- **2026-10-29:** Added an internal workspace control panel, a server-side
  allowlist guard, and organization suspension enforced on protected CRM API
  requests. Added subscription plan selection, server-side access/expiry
  enforcement, a local test trial, admin plan controls, and an expiry warning.
  Razorpay checkout and payment-verified activation remain pending.
- **2026-10-29:** Added a local-only seeded platform admin account for testing.
  Provision it with `npm run db:seed` and add its email to the local
  `PLATFORM_ADMIN_EMAILS` setting.
- **2026-10-29:** Made expired workspaces explicitly reactivatable on a
  selected plan and refreshed the admin console with workspace metrics,
  search, status filters, clearer renewal actions, and responsive styling.
  Frontend typecheck and all 53 API tests passed.
- **2026-10-29:** Shortened the local test trial to two days, moved the expiry
  warning to the final day, and clarified that admin plan controls apply to
  customer workspaces. Replaced the admin console's misleading CRM return link
  with sign-out. Frontend typecheck and 12 focused billing/admin tests passed.

- **2026-10-30:** Enhanced the internal control panel with per-workspace member viewing, plan cancellation, refresh, confirmation prompts, and more resilient API error handling. API and web typechecks and builds pass.
- **2026-10-30:** Added tenant-scoped activities API (list/create/read/update/delete), validation of related records and assignment targets, completedAt lifecycle handling, and API unit coverage.
- **2026-10-30:** Added a platform audit log model, service, admin-only read endpoint, and audit recording for workspace onboarding, suspension/restoration, and subscription changes.

## Next session

- Preview web/API servers were stopped at the user's request; PostgreSQL and
  local seed data remain available.
- The same-origin API proxy was verified for login, lead listing, lead creation,
  and archival through the web origin. Sign in with the local-only credentials
  in `DEMO-CREDENTIALS.local.md`.
- Next, visually verify the lead dialog and responsive layouts in the browser,
  then continue with the remaining CRM work. Re-run `npm run api:test`,
  `npm run api:typecheck`, `npm run typecheck`, and `npm run build` after edits.
