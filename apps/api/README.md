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

## Activities and tasks — proposed contract

The Activities screen at `/activities` uses `GET /api/v1/activities`,
`POST /api/v1/activities`, `GET /api/v1/activities/:id`,
`PATCH /api/v1/activities/:id`, and `DELETE /api/v1/activities/:id`.
Requests use the shared bearer session and `x-organization-id`; the API verifies
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
of that organization. Until the member-directory endpoint is available, the UI
defaults new activities to the signed-in member and does not offer a member
picker.

**Open for shared-contract agreement:** `DELETE` currently soft-archives an
activity, matching the existing CRM records. The implementation provisionally
uses the interim role matrix: Owner, Admin, and Sales Manager can read, create,
update, assign, and archive organization activities; Sales Representatives can
read and update assigned activities and create activities assigned to
themselves, but cannot reassign or archive; Read-only Users can read. Confirm
or revise both archive semantics and role rules before treating these as the
shared policy.

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
