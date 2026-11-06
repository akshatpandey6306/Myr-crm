# Service Decomposition

**Status: Strangler migration started; the CRM API is the only backend service.**

## Runtime map and request flow

```text
Browser
  -> Next.js same-origin /api/v1 proxy
  -> NestJS CRM API (session + membership + role checks)
  -> PostgreSQL (CRM and identity tables)
```

Next.js forwards `/api/v1/*` to the NestJS API. The API authenticates its
HttpOnly session cookie, resolves the selected organization from an active
membership, and performs role and record-level checks before touching data.

## Current ownership

| Runtime | Capability and ownership | Persistence |
| --- | --- | --- |
| `src/` Next.js app | Browser UI and same-origin API proxy | None |
| `apps/api/` NestJS CRM API | Identity, organizations, memberships, CRM records, activities, automations, email outbox, reports, notifications, tenant audit logs, settings, billing, platform control panel | Existing Prisma schema and PostgreSQL migrations |

Email delivery is disabled. CRM email messages may be saved to the organization
outbox, but they are never sent. No SMTP runtime or mail credentials are
required.

New workspace signups create pending Owner accounts for platform-admin review.
Teammates register accounts, request workspace access with a join code, and
wait for workspace Owners/Admins to approve or decline from Team & access.
Pending requests also appear in the workspace notification feed.

## Local development and deployment

Copy `.env.example` to `.env`. Start PostgreSQL and initialize migrations using
the root README instructions. Run these processes in separate terminals:

```sh
npm run api:dev
npm run dev
```

Deploy the Next.js app and CRM API as separate runtimes. There is no email
service to deploy.

## Data migration

The CRM API remains the sole owner of its current shared Prisma schema. Apply
committed migrations in timestamp order with `npm run db:deploy`; never reset a
database. The in-app approval migration adds pending workspace/member states,
workspace join codes, and generic member-request notifications.

## Remaining strangler work

The CRM API is still a modular monolith. Identity, organizations, memberships,
leads, contacts, companies, deals, pipelines, activities, automations,
notifications, reports, audit logs, settings, billing, and control-panel
endpoints still share one NestJS runtime and Prisma owner. They are not
independent services yet.

Next extraction should begin with a capability whose writes can be separated
from CRM transactions, such as notifications or audit delivery. For every
future service, first define an authenticated contract, data ownership,
idempotency, observability, and a rollback plan.
