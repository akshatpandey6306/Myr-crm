# Myr CRM - Integration and Microservice Conversion Plan

## 1. DEVELOPER CONTRIBUTION SUMMARY

### Dev 1 (Modules 1-8)
- **Module 1: Authentication and Security**
  - Session management (HttpOnly cookies, 7-day expiry)
  - Password hashing and verification
  - Email verification with expiring tokens
  - Rate limiting on auth endpoints
  - Password reset with session revocation

- **Module 2: Organization and Multi-tenancy**
  - Organization creation with atomic Owner membership
  - Organization list/create endpoints
  - Membership management (role assignment, revocation)
  - Partial unique index: at most one active Owner per organization

- **Module 3: User and Role Management**
  - User CRUD operations
  - Role assignment (Owner, Admin, Sales Manager, Sales Rep, Read-only)
  - Member invitation system
  - Role-based access control matrix

- **Module 4: Dashboard Data API Dependencies**
  - Dashboard data aggregation API
  - Coordinated dependencies with other CRM modules

- **Module 5: Leads**
  - Full CRUD with tenant scoping
  - Lead source tracking (website, referral, linkedin, other)
  - Lead status pipeline (new → contacted → qualified → disqualified)
  - Tenant composite foreign keys for data isolation
  - Contact-email uniqueness per organization

- **Module 6: Contacts**
  - Full CRUD with tenant scoping
  - Contact email uniqueness per organization
  - Archive/search/filter/sort/pagination behavior
  - Tenant-scoped relationship validation

- **Module 7: Companies**
  - Full CRUD with soft archival
  - Search/sort/pagination
  - Server-controlled ownership
  - Tenant-scoped persistence

## 2. SERVICE BOUNDARIES PROPOSAL

Based on the module analysis and the master prompt requirements, the following service decomposition is proposed:

### Service 1: Identity & Authentication Service
- **Purpose**: Owns authentication, authorization, and session management
- **Modules**: Dev 1 Module 1 (auth), Module 2 (org/membership foundation), Module 3 (user/roles)
- **Public REST API**: `POST /api/v1/auth/signup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/password-reset`, `POST /api/v1/auth/email-verification`, `GET /api/v1/auth/me`, `GET /api/v1/organizations` (list where user has membership)
- **Data Ownership**: Users, sessions, password reset tokens, email verification tokens, organizations, memberships
- **Authentication & Authorization**: Derives userId from verified server-side session; enforces membership checks on every protected request
- **Tenant Context**: Organization scope derived from active membership; client-supplied organizationId only a selector verified by API
- **Dependencies**: Prisma (users, organizations, memberships tables), Redis (rate limits), JWT for internal service comms
- **Health Checks**: `/health` - database connectivity, `/ready` - session store readiness
- **Startup**: `npm run api:dev` (with PostgreSQL and Redis)

### Service 2: CRM Core Service
- **Purpose**: Owns all core CRM records (leads, contacts, companies, deals, pipelines)
- **Modules**: Dev 1 Module 5 (leads), Module 6 (contacts), Module 7 (companies), Module 8 (deals/pipelines)
- **Public REST API**: `GET/POST /api/v1/leads`, `GET/PATCH /api/v1/leads/:id`, `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/:id`, `GET/POST /api/v1/companies`, `GET/PATCH /api/v1/companies/:id`, `GET/POST /api/v1/deals`, `GET/PATCH /api/v1/deals/:id`, `GET/POST /api/v1/pipelines`, `GET/PATCH /api/v1/pipelines/:id`
- **Data Ownership**: Leads, Contacts, Companies, Deals, Pipeline stages
- **Authentication & Authorization**: All requests require verified session + active membership; organization scope from verified membership
- **Tenant Context**: Every record must have non-null organizationId; scope all reads/writes to verified organization
- **Dependencies**: Prisma (lead, contact, company, deal models), Organization service for membership validation
- **Health Checks**: `/health` - database connectivity, `/ready` - tenant context validity
## 3. INCREMENTAL MIGRATION STRATEGY (Strangler Pattern)

### Phase 1: Foundation (Weeks 1-2)
- Set up separate runtimes for each service
- Establish shared type contracts and API gateway
- Migrate authentication to Identity service (extract from monolith)
- Set up API gateway at /api/v1 routing
- Update frontend to use new service boundaries

### Phase 2: Core CRM Extraction (Weeks 3-6)
- Extract Leads service (Service 2 core)
- Extract Contacts service
- Extract Companies service
- Extract Deals/Pipelines service
- Update monolith to route API calls to new services

### Phase 3: Activities and Automations (Weeks 7-9)
- Extract Activities service (Service 3)
- Extract Automations service (Service 4)
- Set up messaging for automation events

### Phase 4: Supporting Services (Weeks 10-12)
- Extract Email service (Service 5 - already separate)
- Extract Reports service (Service 6)
- Extract Notifications service (Service 7)
- Extract Audit Logging service (Service 8)

### Phase 5: Cleanup and Optimization (Weeks 13+)
- Remove extracted code from monolith
- Update shared contracts
- Optimize data ownership
- Final integration testing
### Service 3: Activities & Tasks Service
- **Purpose**: Owns activities, tasks, calls, meetings, notes
- **Modules**: Dev 2 Module 9 (activities/tasks)
- **Public REST API**: `GET/POST /api/v1/activities`, `GET/PATCH/DELETE /api/v1/activities/:id`
- **Query Parameters**: q, type, status, priority, assignedToUserId, relatedToType, relatedToId, page, pageSize, sortBy, sortOrder
- **Data Ownership**: Activities (organizationId required, assignedToUserId optional)
- **Authentication & Authorization**: Verified session + active membership; scope to organization; role-based permissions (Owner/Admin/Manager can all, Rep only assigned)
- **Tenant Context**: organizationId from verified membership; related records validated within same organization
- **Dependencies**: Prisma (activity model), Notification service for assignment change events
- **Health Checks**: `/health` - database connectivity, `/ready` - activity count validity
- **Startup**: `npm run api:dev`

### Service 4: Automations Service
- **Purpose**: Owns automation rules and execution runs
- **Modules**: Dev 2 Module 10 (automations)
- **Public REST API**: `GET/POST /api/v1/automations`, `GET/PATCH /api/v1/automations/:id`, `POST /api/v1/automations/:id/run`
- **Message Contracts**: `automation_rule_created`, `automation_rule_triggered`, `automation_run_completed`
- **Data Ownership**: AutomationRules, AutomationRun (all organization-scoped)
- **Authentication & Authorization**: Verified session + active membership; Owner/Admin can manage rules; Sales Rep can trigger within assigned scope
- **Tenant Context**: organizationId from verified membership on all rules and runs
- **Dependencies**: Prisma (automation_rule, automation_run models), CRM Core for lead/contact targets, Notification service for run completion alerts
- **Health Checks**: `/health` - database connectivity, `/ready` - rule validation validity
- **Startup**: `npm run api:dev`

### Service 5: Email Delivery Service (EXISTING)
- **Purpose**: SMTP transport for outbound email
- **Modules**: Dev 2 Module 11 (email), existing `apps/email-service/`
- **Internal API**: `POST /internal/v1/email` with `{ to, subject, text }` and `Authorization: Bearer <EMAIL_DELIVERY_TOKEN>`
- **Data Ownership**: No database - CRM API owns EmailMessage state; email service only sends SMTP
- **Authentication**: Bearer token shared between API and service (EMAIL_DELIVERY_TOKEN)
- **Health Checks**: `/health` - liveness, `/ready` - whether SMTP is configured
- **Startup**: `npm run email:dev` (separate terminal)
- **Note**: Already partially implemented as separate runtime

### Service 6: Reports & Analytics Service
- **Purpose**: Owns reports, dashboards, analytics data
- **Modules**: Dev 2 Module 12 (reports)
## 7. COMMANDS CHECKED AND RESULTS

- `npm run typecheck` - Passes for both root and apps/api
- `npm run test` - 8 test files passed, 16 tests passed
- `npm run db:generate` - Prisma client generated successfully
- `npm run db:deploy` - 22 migrations deployed after resolving 2 failed migrations
- `npm run dev` - Next.js dev server starts at http://localhost:3000
- `npm run api:dev` - NestJS API starts at http://localhost:4000
- `npm run email:dev` - Email service starts at http://localhost:4100
## 6. FILES AND AREAS CHANGED (During Integration)

- `apps/api/prisma/migrations/20261030123000_audit_logs/migration.sql`: Renamed audit_logs → platform_audit_logs, created new audit_logs table
- `apps/api/prisma/migrations/20261105100000_platform_audit_log/migration.sql`: Added FK from platform_audit_logs.actor_user_id to users.id
- `package.json`: npm workspaces for `apps/api` and `apps/email-service`
- `.env.example`: Environment configuration with DATABASE_URL, SMTP settings, EMAIL_DELIVERY_TOKEN
- `apps/api/src/app.module.ts`: All 15 modules configured as NestJS controllers in single runtime
- `docs/architecture/service-decomposition.md`: Current state documentation (strangler migration started)
- `INTEGRATION_PLAN.md`: This integration and microservice conversion plan
## 5. CONFLICTS AND MAJOR ARCHITECTURE DECISIONS

### Resolved Conflicts:
1. **Migration `20261030123000_audit_logs`**: Renamed original `audit_logs` table to `platform_audit_logs`, created new `audit_logs` table - resolved during mergetest branch merge
2. **Migration `20261105100000_platform_audit_log`**: Added foreign key from `platform_audit_logs.actor_user_id` to `users` - resolved during merge
3. **Shared Prisma schema**: Both developers worked on same schema; migrations committed in timestamp order preserve existing organization access with active defaults

### Key Decisions:
1. **Keep email service as separate runtime** from the start - already established in `apps/email-service/`
2. **Strangler migration approach** - keep monolith functional while extracting services incrementally
3. **Single PostgreSQL server initially** - separate databases only when justified by operational needs
4. **REST APIs under `/api/v1`** unless existing repository provides compatible convention
5. **Messaging for async workflows** - email sending, automation execution, notification delivery via BullMQ or similar
6. **API gateway/backend-for-frontend** - Next.js proxies to `/api/v1`, routes to appropriate services as they're extracted
## 4. DATA OWNERSHIP AND TENANT CONTEXT PROPAGATION

### Key Principles:
1. **Organization is the tenant boundary** - every tenant-owned record must carry organizationId
2. **User ID derived from verified server-side session** - body/query/state never proof of identity
3. **Client-supplied organizationId is only a selector** - API verifies active membership on every protected request
4. **Tenant scope applied to ALL reads, writes, search, pagination, relationships**
5. **Related records must belong to same organization** - validated before linking

### Propagation Pattern:
```
Frontend (Next.js)
  → API Gateway / NestJS API (/api/v1)
    → Extracts: userId from session, organizationId from verified membership
    → Propagates: x-organization-id, x-user-id headers to downstream services
    → Services validate membership before any data operation
    → Cross-service references go through owning-service contracts
    → Audit events include: organizationId, userId, action, resourceType, resourceId
```

### Cross-Service Reference Pattern:
- **Never trust** a client-supplied ID as proof of authorization
- **Always validate** through the owning service's contract
- **Use trusted headers**: `x-organization-id`, `x-user-id` (set by API gateway)
- **Database constraints**: Partial unique indexes per organization where applicable
- **Public REST API**: `GET /api/v1/reports`, `GET /api/v1/reports/:id` (tenant-scoped)
- **Data Ownership**: Report definitions, dashboard configurations, analytics metrics (all organization-scoped)
- **Authentication & Authorization**: Verified session + active membership; read access based on role
- **Tenant Context**: organizationId from verified membership
- **Dependencies**: Prisma (report model), CRM Core for data aggregation
- **Health Checks**: `/health` - database connectivity
- **Startup**: `npm run api:dev`

### Service 7: Notifications Service
- **Purpose**: Owns notification delivery and activity assignment/completion events
- **Modules**: Dev 2 Module 13 (notifications)
- **Public REST API**: `GET/POST /api/v1/notifications`, `GET /api/v1/notifications/:id` (tenant-scoped)
- **Message Contracts**: `activity_assigned`, `activity_completed`, `notification_delivered`
- **Data Ownership**: Notifications (organization-scoped, linked to activities/users)
- **Authentication & Authorization**: Verified session + active membership
- **Tenant Context**: organizationId from verified membership; userId from session
- **Dependencies**: Prisma (notification model), Activity service for event triggers, Email service for delivery
- **Health Checks**: `/health` - database connectivity
- **Startup**: `npm run api:dev`

### Service 8: Audit Logging Service
- **Purpose**: Owns platform audit logs and historical tracking
- **Modules**: Dev 2 Module 14 (audit logs)
- **Important**: Modified migrations renamed `audit_logs` -> `platform_audit_logs` and created new `audit_logs` table
- **Public REST API**: `GET /api/v1/audit-logs` (tenant-scoped, role-based access)
- **Data Ownership**: platform_audit_logs (actor_user_id, resource_type, resource_id, action, organization_id, created_at)
- **Authentication & Authorization**: Verified session + active membership; role-based (Owner/Admin can view; others restricted)
- **Tenant Context**: organizationId from verified membership; every audit record must belong to request organization
- **Dependencies**: Prisma (platform_audit_logs, audit_logs models - both must coexist during transition)
- **Health Checks**: `/health` - database connectivity
- **Startup**: `npm run api:dev`
## 3. INCREMENTAL MIGRATION STRATEGY (Strangler Pattern)
### Phase 1: Foundation (Weeks 1-2)
- Set up separate runtimes for each service
- Establish shared type contracts and API gateway
- Migrate authentication to Identity service (extract from monolith)
- Set up API gateway at /api/v1 routing
- Update frontend to use new service boundaries
## 4. DATA OWNERSHIP AND TENANT CONTEXT PROPAGATION

### Key Principles:
1. **Organization is the tenant boundary** - every tenant-owned record must carry organizationId
2. **User ID derived from verified server-side session** - body/query/state never proof of identity
3. **Client-supplied organizationId is only a selector** - API verifies active membership on every protected request
4. **Tenant scope applied to ALL reads, writes, search, pagination, relationships**
5. **Related records must belong to same organization** - validated before linking

### Propagation Pattern:
```
Frontend (Next.js)
  → API Gateway / NestJS API (/api/v1)
    → Extracts: userId from session, organizationId from verified membership
    → Propagates: x-organization-id, x-user-id headers to downstream services
    → Services validate membership before any data operation
    → Cross-service references go through owning-service contracts
    → Audit events include: organizationId, userId, action, resourceType, resourceId
```

### Cross-Service Reference Pattern:
- **Never trust** a client-supplied ID as proof of authorization
- **Always validate** through the owning service's contract
- **Use trusted headers**: `x-organization-id`, `x-user-id` (set by API gateway)
- **Database constraints**: Partial unique indexes per organization where applicable

## 5. CONFLICTS AND MAJOR ARCHITECTURE DECISIONS

### Resolved Conflicts:
1. **Migration `20261030123000_audit_logs`**: Renamed original `audit_logs` table to `platform_audit_logs`, created new `audit_logs` table - resolved during mergetest branch merge
2. **Migration `20261105100000_platform_audit_log`**: Added foreign key from `platform_audit_logs.actor_user_id` to `users` - resolved during merge
3. **Shared Prisma schema**: Both developers worked on same schema; migrations committed in timestamp order preserve existing organization access with active defaults

### Key Decisions:
1. **Keep email service as separate runtime** from the start - already established in `apps/email-service/`
2. **Strangler migration approach** - keep monolith functional while extracting services incrementally
3. **Single PostgreSQL server initially** - separate databases only when justified by operational needs
4. **REST APIs under `/api/v1`** unless existing repository provides compatible convention
5. **Messaging for async workflows** - email sending, automation execution, notification delivery via BullMQ or similar
6. **API gateway/backend-for-frontend** - Next.js proxies to `/api/v1`, routes to appropriate services as they're extracted

## 6. FILES AND AREAS CHANGED (During Integration)

- `apps/api/prisma/migrations/20261030123000_audit_logs/migration.sql`: Renamed audit_logs → platform_audit_logs, created new audit_logs table
- `apps/api/prisma/migrations/20261105100000_platform_audit_log/migration.sql`: Added FK from platform_audit_logs.actor_user_id to users.id
- `package.json`: npm workspaces for `apps/api` and `apps/email-service`
- `.env.example`: Environment configuration with DATABASE_URL, SMTP settings, EMAIL_DELIVERY_TOKEN
- `apps/api/src/app.module.ts`: All 15 modules configured as NestJS controllers in single runtime
- `docs/architecture/service-decomposition.md`: Current state documentation (strangler migration started)
- `INTEGRATION_PLAN.md`: This integration and microservice conversion plan

## 7. COMMANDS CHECKED AND RESULTS

- `npm run typecheck` - Passes for both root and apps/api
- `npm run test` - 8 test files passed, 16 tests passed
- `npm run db:generate` - Prisma client generated successfully
- `npm run db:deploy` - 22 migrations deployed after resolving 2 failed migrations
- `npm run dev` - Next.js dev server starts at http://localhost:3000
- `npm run api:dev` - NestJS API starts at http://localhost:4000
- `npm run email:dev` - Email service starts at http://localhost:4100

## 8. FUNCTIONALITY REMAINING IN MONOLITH

Until incremental extraction completes, the following remain in the modular monolith:
- All 15 module APIs under NestJS single runtime
- Prisma ORM with shared PostgreSQL schema
- Next.js frontend proxying to `/api/v1`
- Email delivery via outbox pattern (API → email-service SMTP)

**Migration goal**: Extract each service boundary incrementally while preserving data and keeping the monolith as compatibility path until all services are running.
