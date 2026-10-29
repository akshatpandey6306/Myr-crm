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

The web app provides `/sign-in` and `/sign-up`. The API exposes `POST
/api/v1/auth/login`, `POST /api/v1/auth/signup`, `POST /api/v1/auth/logout`,
and `GET /api/v1/auth/me`. Signup creates an owner membership for the new
workspace and persists the user, organization, owner membership, and session in
PostgreSQL. Sessions store only a SHA-256 token digest and expire after seven
days. `GET /api/v1/organizations` lists the caller's active memberships and
`POST /api/v1/organizations` creates another workspace with the caller as owner.
Organization IDs in `x-organization-id` select a tenant only after the API
verifies the caller's active membership. The Next.js app proxies browser
requests through its own `/api/v1` origin to avoid browser-host and CORS issues.
Set `API_PROXY_URL` on the web server if the API is not at
`http://localhost:4000/api/v1`. Set `WEB_ORIGIN` to the web app origin when it
differs from `http://localhost:3000`.

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

Leads are scoped to the authenticated user's active organization. Requests use
the bearer token established by sign-in; `x-organization-id` may select an
organization only when the user is a member of it. The list endpoint accepts
`q`, `source`, `status`, `page`, `pageSize`, `sortBy`, and `sortOrder`. Create,
update, and archive use
`POST /api/v1/leads`, `PATCH /api/v1/leads/:id`, and
`DELETE /api/v1/leads/:id`. Deletion archives a lead, and archived leads are
excluded from the active list. Contacts use matching CRUD routes under
`/api/v1/contacts`, with `q`, pagination, and sorting on the list route.
