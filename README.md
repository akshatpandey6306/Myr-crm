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

- The web UI has API-backed dashboard, leads, contacts, companies, deals, and
  team screens plus sign-in/sign-up forms. Activities, automation, and reports
  still use preview data or placeholders.
- The NestJS API has health, authentication, organizations, organization-member
  listing, internal control-panel, billing/subscription, dashboard summary, leads, contacts,
  companies, deals, and pipeline routes.
- PostgreSQL/Prisma persistence currently covers users, organizations,
  memberships, subscriptions, sessions, refresh tokens, and persistent
  authentication rate limits. Signup creates the initial
  Owner membership and an unlicensed workspace atomically. Subscription status
  and expiry are checked along with organization membership on protected API
  requests. Local test mode offers one no-charge 2-day trial; PayU checkout is
  not connected and no online payment is collected.
- Leads, contacts, companies, deals, and pipelines persist in PostgreSQL.
  Their queries, updates, and archives are organization-scoped; membership and
  composite foreign keys prevent cross-organization owner/creator and related
  record references. Company and deal CRUD is soft-archived, and pipelines
  support basic management of names and stages. The CRM screens use the API
  and are responsive. Activities have a tenant-scoped API but no integrated
  workspace UI; Automation and Reports remain previews.
- The dashboard metrics, pipeline distribution, and recent open deals use a
  tenant-scoped API summary. Recent activity and upcoming tasks remain
  placeholders for the Activities module.
- Browser authentication uses short-lived HttpOnly session cookies and rotating
  HttpOnly refresh cookies; bearer clients can rotate refresh tokens through the
  API. Password-reset and email-verification links use the configured Resend
  delivery service, with UI flows for recovery and verification. Production
  workspace access requires verified email. Authentication throttles are
  database-backed and shared across API instances. Configure `EMAIL_API_KEY`
  and `EMAIL_FROM` before production signup/recovery. Full permission
  administration remains outstanding.
- The interim Owner/Admin/Manager/Representative/Read-only policy is
  API-enforced; owners/admins can manage members except the Owner account,
  admins cannot change their own role, and only owners can transfer ownership.
  Developer 2 should review the policy and shared contracts before they are
  treated as final.
- Internal platform administrators can onboard and search customer
  workspaces, review owner/member and seat details, filter by access,
  subscription, plan, and signup date, and manually manage plans, CRM module
  access, and subscriptions. Sensitive access/subscription/module changes
  require a reason and are audited. Configure `PLATFORM_ADMIN_EMAILS` in the
  API environment. The local seed creates `admin@myrcrm.local` /
  `MyrAdmin123!` for testing only; never use or allowlist this account outside
  a local development database.
- Workspaces without an active subscription are redirected to plan selection,
  and subscription expiry is enforced by protected API routes. Local
  `BILLING_TEST_MODE=true` allows one no-charge 2-day test trial, with a
  header expiry warning during its final day. The subscription page shows
  configured rates and PayU branding, but checkout, payment verification, and
  webhooks are not connected, so displayed prices are not being charged.
  Expired workspaces can request manual platform-team activation; allowlisted
  platform administrators bypass the subscription gate and use the control
  panel without needing a customer subscription.

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
  Online checkout and payment-verified activation remain pending.
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
- **2026-11-04:** Clarified expired-subscription plan rates and manual activation on the subscription page, and routed platform administrators around the workspace subscription gate to the control panel. Web typecheck and production build passed.
- **2026-11-04:** Fixed production API `.env` discovery for compiled starts, counted failed logins against throttling, prevented production responses from exposing development verification/reset tokens, and revoked active sessions on password reset. The local production API and web proxy health checks returned 200; Prisma reports no pending local migrations.
- **2026-11-04:** Adopted the documented role matrix as interim Developer 1 policy. Added tenant-scoped member role changes, ownership transfer with concurrent-update safeguards, protected owner/admin operations, audit records, and Team UI controls. API typecheck/build and all 87 API tests passed; the web production build, Prisma schema validation, dependency audit, and `git diff --check` also passed. No Render deployment was performed.
- **2026-11-04:** Added password-reset and email-verification pages with Resend-backed delivery, production verification gating, database-backed auth throttles, and rotating 15-minute sessions/30-day refresh tokens. API/web typechecks and builds passed; all 92 API tests passed; Prisma validation and dependency audit passed (0 vulnerabilities); the migration was applied to the local database and the schema is current; API and web-proxy health returned 200. No Render deployment or commit was made.
- **2026-11-04:** Enhanced the platform-admin control panel without removing onboarding, owner/member details, manual subscription/module actions, plan management, or audit history. Added tenant search/filters, seat usage including pending invitations, recent-audit filtering, and required audited reasons for sensitive changes. Added a PayU wordmark/status notice only; online payments remain unavailable pending provider details and credentials.
  Final checks: all 95 API tests, frontend typecheck, and `git diff --check`
  passed. API typecheck/build and the web production build also passed on
  2026-11-04. The local API health endpoint returned 200 and the web app
  rendered the sign-in page successfully. No Render deployment or commit was
  made.

## Remaining work before production

- Configure Render web/API services and PostgreSQL, apply migrations with
  `npm run db:deploy`, and provide production `EMAIL_API_KEY`, `EMAIL_FROM`,
  `WEB_ORIGIN`, `API_PROXY_URL`, `DATABASE_URL`, and `PLATFORM_ADMIN_EMAILS`.
- Follow the [Render deployment guide](docs/deployment/render.md) for service
  commands and production settings.
- PayU checkout, payment verification, and webhooks are not integrated; the
  subscription page displays rates and provider branding, but plan activation
  remains manual. Obtain the PayU product/region and credentials and separately
  implement and validate self-service payments before accepting real payments.
- Developer 2 should review the interim role policy and agree on remaining
  cross-module permissions/contracts. Activities UI, Automation, and Reports
  are also unfinished product work.
- No production deployment has been run.
