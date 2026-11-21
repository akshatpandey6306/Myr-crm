# LeadPilot CRM codebase audit

**Date:** 21 November 2026  
**Scope:** frontend routes and role gates, API security and tenant scoping, CRM/pipeline workflows, database shape and query patterns, test/build health, and runtime efficiency.

## Executive summary

The application has a sound baseline for tenant isolation: authentication, active workspace membership, subscription status, and module access are checked by global guards; record APIs generally scope queries by the verified organization; and sensitive control-panel routes use a dedicated platform-admin guard. Controller tests cover many cross-tenant and role-boundary cases.

The main confirmed runtime defect in the supplied logs was Prisma interactive transactions exceeding the default 5-second timeout. The plan save took 6.729 seconds before commit, while sign-in also failed waiting to start a transaction. The Prisma client defaults have since been raised to a 15-second acquisition wait and 30-second transaction limit in `apps/api/src/prisma/prisma.service.ts`.

The test suite had been out of sync with code: signup UI tests mocked `Response.json()` although the form reads `Response.text()`, and two API tests still imported the intentionally removed telemetry implementation. Those stale tests and the residual web-vitals sender have been corrected/removed. The full unit suites now pass.

The remaining highest-value work is adding pagination to platform-wide data screens, making pipeline creation concurrency-safe, adding database-level tenant isolation as defense in depth, and running real browser/device and database load tests. Those live checks could not be completed in this environment.

## Validation performed

| Check | Result |
|---|---|
| Frontend tests | Pass: 16 files, 41 tests |
| API tests | Pass: 36 suites, 237 tests |
| Frontend TypeScript | Pass |
| API TypeScript | Pass |
| API production compile | Pass |
| Next.js production build | TypeScript and Turbopack compile passed, but output generation failed creating `.next/server/app/...` directories with Windows `EPERM`; webpack build failed on the same filesystem operation. This is consistent with the restricted workspace ACL, so a clean production artifact remains unverified. |
| Browser viewport review | Not completed: computer-use approval timed out. Responsive conclusions below are static code review, not visual sign-off. |
| Load/latency test | Not completed: the app API was not reachable from the audit process. The only runtime measurements are the timings in the supplied log. |

The installed runtime is Node `v24.14.1`. The earlier install output reported several test dependencies require `^24.15.0` (or `^22.22.2`/`>=26`); tests passed, but aligning Node to a supported version will remove engine warnings and reduce environment drift.

## Findings and recommended fixes

### P1 — Long-running interactive transactions can still time out at scale

**Evidence:** the supplied API log records a plan-update transaction lasting 6.729 seconds against Prisma’s 5-second default, plus login transaction acquisition failures. `updatePlan` performs the base-plan update, updates every workspace override, and updates enabled modules for every active workspace in one interactive transaction.

**Status:** the client defaults now allow 15 seconds to acquire a transaction and 30 seconds to finish. This addresses the observed 6.7-second case and the login acquisition wait. It is a mitigation rather than a hard guarantee: a large tenant count, a slow pool, or database contention can still exceed 30 seconds. Measure p50/p95/p99 on a production-like database, and consider replacing broad fan-out work with bounded batches or a background job while preserving update consistency.

### P1 — Platform admin workspace overview reads and aggregates the entire installation

**Evidence:** `apps/api/src/control-panel/control-panel.controller.ts` `listOrganizations` loads every organization and related seat purchases, then performs membership, deal, and subscription-payment group-bys across the full database. The query has no pagination or cap.

**Impact:** response time, memory, and database work grow with all customers. This can become a platform-wide latency or overload point even when an admin views one page.

**Fix:** add cursor pagination to the organizations list, compute metrics only for the returned organization IDs (or pre-aggregate them), and paginate or summarize seat purchases. Keep separate count/summary endpoints if the UI needs global totals.

### P2 — Pipeline creation and stage addition have concurrency races

**Evidence:** `apps/api/src/pipelines/pipelines.controller.ts` checks for a default pipeline and creates it in separate operations. It also reads the last stage position and creates the next stage in separate operations. The schema enforces unique stage positions but does not enforce one default pipeline per organization.

**Impact:** concurrent manager requests can create two defaults, or collide on a stage position and return an unexpected 500.

**Fix:** make default selection and pipeline creation atomic and enforce one default pipeline with a partial unique database index. Allocate stage positions in a transaction with a retry on the unique-position conflict (or use an atomic per-pipeline counter).

### P2 — Tenant isolation is application-enforced; no PostgreSQL RLS policies were found

**Evidence:** no `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements were found in Prisma migrations. The API relies on `AuthGuard`, `OrgGuard`, and tenant-scoped Prisma filters.

**Assessment:** this is not evidence of a current cross-tenant exploit; the application layer has meaningful safeguards and tests. It is a defense-in-depth gap: a future endpoint that omits an organization predicate, or an unintended direct database path, would not be stopped by database policy.

**Fix:** consider enabling RLS for tenant tables with transaction-local organization context and policies, and add integration tests that use the runtime DB role. Continue scoping queries in the application even after adding RLS.

### P2 — Every protected API call pays for session and membership lookups

**Evidence:** the global `AuthGuard` performs a session lookup (`auth.guard.ts`), then the global `OrgGuard` performs a membership and workspace lookup (`org.guard.ts`). The login flow also has an interactive serializable transaction for device enforcement. These operations add round trips before controller work.

**Impact:** database latency and pool pressure are amplified across otherwise small CRM reads. The supplied login failures are consistent with the connection/transaction path being sensitive to pool delays.

**Fix:** measure query timings before changing security behavior. Then reduce selected columns, review supporting indexes against actual query plans, and consider a short-lived verified-context cache with explicit invalidation for logout, membership changes, and module changes. Do not cache without preserving revocation semantics.

### P2 — Health endpoint is liveness-only, not readiness

**Evidence:** `apps/api/src/health/health.controller.ts` returns `{ status: "ok" }` without checking PostgreSQL or required dependencies.

**Impact:** a process can report healthy while sign-in, plan saves, and all tenant reads fail because the database is unavailable.

**Fix:** keep a lightweight liveness endpoint and add a readiness endpoint that performs a bounded database ping and reports dependency readiness without exposing connection details.

### P2 — No end-to-end role and workflow matrix

**Evidence:** coverage is primarily controller/component unit tests. There are no browser E2E suites that exercise Owner, Admin, Sales Manager, Sales Rep, Read-only, and custom permission profiles across the complete UI and API.

**Impact:** unit tests verify key guards and managers, but cannot catch mismatches between navigation visibility, responsive layouts, form behavior, API errors, and multi-step flows.

**Fix:** add an E2E matrix for each role: sign-in, module visibility, assigned-record restrictions, create/edit/archive permissions, employee workspace module grants, lead conversion, deal stage movement, activities, and denied direct API requests. Include desktop, tablet, and phone viewports.

### P3 — Responsive UI has extensive global cascade and duplicated shells

**Evidence:** `src/app/globals.css` is 8,713 lines with many repeated breakpoints. The overview in `src/app/page.tsx` renders its own sidebar/topbar while `src/app/components/CrmShell.tsx` implements another shell for module routes.

**Impact:** global selector order and duplicated shell markup make spacing, scroll, logo, sidebar, and breakpoint fixes inconsistent between Overview and employee modules. Existing media queries show intentional small-screen behavior, but a static read cannot confirm every module at every viewport.

**Fix:** consolidate the shared shell, migrate page/module styles to CSS modules or scoped layers incrementally, and add screenshot/overflow tests at 360, 390, 600, 768, 1024, and 1440 pixels for each role shell.

### P3 — Unknown dynamic module paths silently render the Leads preview

**Evidence:** `src/app/[module]/page.tsx` uses `records[moduleName] || records.leads`.

**Impact:** a typo or unsupported module URL renders the Leads page rather than a 404. This is confusing and can hide broken navigation.

**Fix:** call Next.js `notFound()` for unsupported module keys after resolving valid routes.

### P3 — Removed telemetry still had a client sender and stale tests

**Evidence:** the root layout mounted `PerformanceVitals`, which posted to `/api/v1/telemetry/web-vitals` even though the corresponding API service had been removed; its test files also failed imports.

**Status:** removed the sender from the root layout and deleted the orphaned sender/tests. Corrected auth test response mocks. The resulting test suites pass.

## Role and security review

- **Owner/Admin:** workspace access is derived from active membership; only Owner/Admin receive unrestricted enabled-module lists and subscription access. Platform admin routes have an additional allowlisted email guard.
- **Sales Manager:** can manage pipeline configuration, assignment workflows, and archive actions; record writes remain tenant-scoped.
- **Sales Rep:** API filters leads/deals/activities/vendors by assignment in relevant list/detail paths; UI visibility alone is not the protection.
- **Read-only:** write helpers reject read-only users; controller tests cover representative boundaries and module restrictions.
- **Custom roles:** custom role names currently select one of the built-in permission profiles. They are labels/profile presets, not arbitrary per-action permissions; keep UI wording aligned with that model.
- **Session and request defenses:** sessions use an HttpOnly cookie and hashed token storage; unsafe cookie requests have Origin checks; production enables Secure cookies and HSTS; CORS is restricted to the configured web origin; authentication endpoints have database-backed rate limits; payment callback signatures/idempotency and partner API-key hashes are implemented.
- **No critical authorization bypass was confirmed by this static review.** This is not a penetration test, and the lack of database RLS remains the main defense-in-depth gap.

## Pipeline and CRM workflow review

The lead conversion path keeps the original lead and history, creates or links company/contact records, and optionally creates a deal. The schema uses organization-scoped composite keys for relationships and a unique conversion per lead. Deal updates validate that the selected pipeline, stage, and company belong to the same workspace. Activity links also carry organization-scoped checks. Unit coverage exists for these controllers and service flows.

The main workflow weakness found is the pipeline/stage concurrency race described above. The pipeline API currently supports creating and renaming pipelines and adding stages; stage reorder, rename/delete, and pipeline archive/delete operations are absent. If those are product requirements, they need explicit APIs and migration-safe behavior for deals already assigned to a stage.

Billing and automation have focused tests for decimal-safe calculations, payment idempotency, and avoiding duplicate automation runs. I did not execute live payment-provider callbacks or a full browser workflow in this audit.

## Remaining verification

1. Re-run `npm.cmd run build` outside the restricted sandbox to confirm `.next` output generation; compilation and typechecking completed before the sandbox returned `EPERM` while creating generated directories.
2. Run a browser role/viewport matrix after the local CRM is started.
3. Run k6/Autocannon (or equivalent) against a staging database with realistic tenant and record counts; report endpoint p50/p95/p99, error rates, database pool wait time, and saturation.
4. Review PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` for list/search/report and platform overview queries with production-like data.
5. Align Node to a version supported by the installed dependency engine ranges.

## API verification follow-up (21 November 2026)

| Check | Result |
|---|---|
| API unit tests | Pass: 36 suites, 237 tests, 0 failures |
| API TypeScript check | Pass |
| API production build | Pass |
| API bootstrap / route registration | Nest initialized and registered the controllers, but the final bind to `0.0.0.0:4000` failed with `EADDRINUSE` |
| Live health request | Not verified: no process was reachable on port 4000 after the bind failure |
| Current migration status | Not verified in this follow-up: Prisma's schema engine returned an empty error; a prior recorded status reported three unapplied migrations |

### API security and runtime review

- Global authentication, organization-context, and rate-limit guards are registered. Organization access checks active membership, workspace subscription, and enabled modules. Platform control-panel routes have a separate platform-admin guard.
- The public routes are limited to auth/health, partner integration, provisioning, and the PayU callback. Partner and provisioning handlers perform credential checks; the PayU callback is explicitly marked external and verifies provider signatures/idempotency. Review the secrets and callback settings in the deployment environment before production use.
- Session tokens are stored hashed and delivered via an HttpOnly cookie. Unsafe cookie requests validate `Origin`; production also requires the expected origin. CORS is restricted to the configured web origin, and standard browser security headers are set.
- No `$queryRawUnsafe` or `$executeRawUnsafe` usage was found in API source. The rate limiter uses parameterized tagged-template SQL and persists counters in PostgreSQL.
- No confirmed auth bypass was found in this code review or the passing guard/controller tests. This does not substitute for penetration testing or a runtime cross-tenant integration test. PostgreSQL RLS is still absent, as noted above.
- Confirmed scale risks remain: platform organization overview reads and aggregates across all organizations without pagination; partner summary loads all mappings/events for that partner into memory; several platform admin summaries aggregate full history. Add bounded pagination/pre-aggregation and measure query plans before large-scale use.
- The API bind race is unresolved. A port check showed 4000 free, but Nest then reported `EADDRINUSE`; a subsequent check found no listener, so the conflicting process could not be identified. Do not treat the CRM as live until API and web processes are started once and `/api/v1/health` succeeds.
- The previous migration status showed `20261120100000_link_lead_calls_to_activities`, `20261120110000_lead_conversions`, and `20261120130000_company_management` unapplied. These may explain failures in affected modules. Verify with `prisma migrate status` from the intended project and apply via the normal migration deployment procedure; the follow-up audit did not apply migrations.
