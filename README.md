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
- The NestJS API has health, authentication, organizations, leads, contacts,
  companies, deals, and pipeline routes.
- PostgreSQL/Prisma persistence currently covers users, organizations,
  memberships, and expiring sessions. Signup creates the initial Owner
  membership atomically. Organization selection is checked against active
  membership on protected API requests.
- Leads, contacts, companies, deals, and pipelines persist in PostgreSQL.
  Their queries, updates, and archives are organization-scoped; membership and
  composite foreign keys prevent cross-organization owner/creator and related
  record references. Company and deal CRUD is soft-archived, and pipelines
  support basic management of names and stages. The Companies and Deals
  screens use the API and are responsive. Activities still have no API or
  durable persistence.
- Password-reset, email-verification, invitation, rate-limit, secure-cookie or
  refresh-token, and full permission-administration flows remain outstanding.
- Organization-specific role policy and the shared Developer 2 contracts still
  need review when that developer is available.

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

## Next session

- Preview web/API servers were stopped at the user's request; PostgreSQL and
  local seed data remain available.
- The same-origin API proxy was verified for login, lead listing, lead creation,
  and archival through the web origin. Sign in with the local-only credentials
  in `DEMO-CREDENTIALS.local.md`.
- Next, visually verify the lead dialog and responsive layouts in the browser,
  then continue with the remaining CRM work. Re-run `npm run api:test`,
  `npm run api:typecheck`, `npm run typecheck`, and `npm run build` after edits.
