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
days. Browser sign-in sets an HttpOnly, SameSite=Lax session cookie; bearer
tokens remain supported for existing API clients. Cookie-authenticated
mutations require the configured `WEB_ORIGIN`. `GET /api/v1/organizations`
lists the caller's active memberships and
`POST /api/v1/organizations` creates another workspace with the caller as owner.
Organization IDs in `x-organization-id` select a tenant only after the API
verifies the caller's active membership. The Next.js app proxies browser
requests through its own `/api/v1` origin to avoid browser-host and CORS issues.
Set `API_PROXY_URL` on the web server if the API is not at
`http://localhost:4000/api/v1`. Set `WEB_ORIGIN` to the web app origin when it
differs from `http://localhost:3000`.

New workspaces start with a pending subscription and cannot access CRM data
until a plan is active. Set `BILLING_TEST_MODE=true` for local development to
let workspace owners start one no-charge, 2-day test trial. This setting is
ignored in production. The internal control panel lists each workspace owner
and subscription, and platform admins can activate a manual 30-day plan, expire
a plan, or suspend workspace access. Razorpay checkout and webhooks are not
connected yet; configure and verify the Razorpay integration before accepting
real payments.

`GET /api/v1/organizations/members` lists active members of the selected,
verified organization. It returns each member's `id`, `name`, and organization
`role`, without exposing email addresses. This endpoint provides member
selection data; individual modules must still enforce their own assignment
permissions and verify assignment targets belong to the active organization.

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
collecting payment. Razorpay checkout, signature verification, and webhooks
still need to be implemented and tested before real payments can activate
subscriptions.

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
