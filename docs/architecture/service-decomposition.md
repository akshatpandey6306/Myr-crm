# Service Decomposition

**Status: Strangler migration started; only SMTP delivery is independently deployed.**

## Runtime map and request flow

```text
Browser
  -> Next.js same-origin /api/v1 proxy
  -> NestJS CRM API (session + membership + role checks)
  -> PostgreSQL (CRM and identity tables)
  -> private email-delivery HTTP call when configured
  -> SMTP provider
```

The browser never calls the email service. Next.js forwards `/api/v1/*` to the
NestJS API. The API authenticates its HttpOnly session cookie, resolves the
selected organization from an active membership, and performs role and
record-level checks before touching data or calling another runtime.

## Current ownership

| Runtime | Capability and ownership | Persistence |
| --- | --- | --- |
| `src/` Next.js app | Browser UI and same-origin API proxy | None |
| `apps/api/` NestJS CRM API | Identity, organizations, memberships, CRM records, activities, automations, email outbox, reports, notifications, tenant audit logs, settings, billing, platform control panel | Existing Prisma schema and PostgreSQL migrations |
| `apps/email-service/` | SMTP transport, delivery validation, and provider error boundary | No database; CRM API owns `EmailMessage` state |

This boundary keeps tenant data and the recipient lookup in the CRM API. The
email service receives only a server-validated recipient, subject, and body. It
does not receive an organization ID, session cookie, or CRM record ID, and has
no access to CRM tables.

## Email contract and failure behavior

- Internal request: `POST /internal/v1/email` with `{ to, subject, text }` and
  `Authorization: Bearer <EMAIL_DELIVERY_TOKEN>`.
- The service validates payload size and fields, then sends one SMTP message.
- `GET /health` reports liveness; `GET /ready` reports whether SMTP is
  configured.
- The API persists the outbox row before calling the service. It records
  successful delivery as `sent` and failures as `failed`.
- There is no automatic retry or idempotency ledger. A lost response after SMTP
  accepts a message is ambiguous; the API does not retry automatically to avoid
  duplicate sends.
- `EMAIL_DELIVERY_URL` and the same high-entropy `EMAIL_DELIVERY_TOKEN` are
  configured only on the API and email-service runtimes. SMTP credentials are
  configured only on the email service. Use a private network and secret store
  in deployed environments.

## Local development and deployment

Copy `.env.example` to `.env`. Start PostgreSQL and initialize migrations using
the root README instructions. Run these processes in separate terminals:

```sh
npm run email:dev
npm run api:dev
npm run dev
```

The example environment enables verification and points the API at the local
delivery service. Without SMTP, the development service logs verification,
reset, and invitation links and reports them as undelivered; configure
`SMTP_HOST`, `SMTP_FROM`, and any required credentials/TLS options to send them.
Use a random `EMAIL_DELIVERY_TOKEN` of at least 24 characters shared by the API
and service. The service loads the root `.env` for local runs. Production processes should
receive environment values from the deployment platform; do not commit secrets.

Deploy the Next.js app, CRM API, and email service as separate runtimes. Allow
API-to-email-service traffic only on the private network. Configure API health
and database readiness independently from email-service `/health` and `/ready`.
SMTP outages should not affect CRM reads and writes except the synchronous
email-send workflow.

## Data migration and rollback

The CRM API remains the sole owner of its current shared Prisma schema. The
subscription and platform-audit migrations added during branch integration are
additive and preserve existing organization access with active defaults. Apply
committed migrations in timestamp order with `npm run db:deploy`; never reset a
database. The email service has no schema migration because it owns no data.

Rollback for the email extraction is configuration-based: clear
`EMAIL_DELIVERY_URL` in development to restore the prior local no-provider
behavior. Production should not silently fall back to direct SMTP in the CRM
API; restore the service deployment or disable delivery while preserving the
outbox records.

## Remaining strangler work

The CRM API is still a modular monolith. Identity, organizations, memberships,
leads, contacts, companies, deals, pipelines, activities, automations,
notifications, reports, audit logs, settings, billing, and control-panel
endpoints still share one NestJS runtime and Prisma owner. They are not
independent services yet.

Next extraction should begin with a capability whose writes can be separated
from CRM transactions, such as notifications or audit delivery. For every
future service, first define an authenticated `/api/v1` or internal contract,
trusted tenant context propagation, service-owned persistence, retries and
idempotency, health/readiness, and an API-gateway route. Do not let a new
service read or write another service's private tables. Until that work is
complete, keep the existing monolith routes active as the compatibility path.