# Identity and Tenant Isolation Contract

**Status: Implemented foundation; remaining policy decisions documented below**

This contract defines the shared foundation for authentication, organization membership, and tenant-owned CRM data. Developer 1 is proceeding with the mandatory PostgreSQL/Prisma stack while Developer 2 is unavailable. Remaining role-policy decisions are still open and must be reviewed before those permissions are enforced.

## Proposed data model

- `User` represents one authenticated person. Authentication-provider identities map to this user; provider credentials are not used as tenant identifiers.
- `Organization` is the tenant boundary.
- `OrganizationMembership` joins a user to an organization and stores that user's organization-scoped role. A user may belong to multiple organizations.
- A membership is unique per `(organizationId, userId)`. Organization creation and the creator's initial owner membership are committed atomically.
- Every tenant-owned record, including leads, contacts, companies, deals, and pipelines, carries a non-null `organizationId`.

The implementation uses PostgreSQL, Prisma ORM, UUID identifiers, password-based authentication, and organization-scoped fixed roles. Password-reset, verification, invitation, and role-administration flows are not part of this first persistence slice.

## Authentication and API boundary

- The server derives `userId` from a verified authentication session. Request bodies, query parameters, and client state are never proof of identity.
- Organization selection may be sent as an organization ID in the route or request context, but the server verifies the authenticated user's membership on every request.
- Tenant-scoped queries and writes include the verified `organizationId`; a record ID alone is never sufficient authorization.
- The initial identity API should expose the authenticated user and their organizations, and allow an authenticated user to create an organization. Creation also creates the caller's owner membership in the same transaction.
- Responses must not expose credentials, session secrets, or another organization's membership data.

Current routes are `POST /api/v1/auth/signup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `GET /api/v1/organizations`, and `POST /api/v1/organizations`. Bearer tokens are random 256-bit values; only their SHA-256 digests are stored, and sessions expire after seven days. Organization creation and the initial owner membership are created in a single nested Prisma transaction.

## Tenant-isolation requirements

- Enforce membership and role checks in server-side authorization code, not only in the UI.
- Apply organization scope to reads, updates, deletes, relationship lookups, and bulk operations.
- Validate that related records belong to the same organization before linking them.
- Derive the organization scope from the verified membership context; do not trust a client-supplied `organizationId` as authorization.
- Add database constraints and indexes for tenant-scoped uniqueness where applicable, for example `(organizationId, email)` when CRM contact emails are unique within an organization.
- Use a consistent not-found/forbidden policy for inaccessible tenant records and test it across API routes.

## Required tests for the first implementation slice

- Unauthenticated requests cannot read or mutate identity or organization data.
- A user can access organizations where they have an active membership and cannot access another tenant's data by substituting its ID.
- Organization creation creates the organization and owner membership atomically; failure leaves neither partially created.
- Revoked or removed membership blocks subsequent requests.
- Tenant-scoped relationship validation rejects linking records from different organizations.

## Decisions needed before implementation

1. Review role semantics with Developer 2 when available, especially whether representatives can view only assigned records.
2. Decide on secure-cookie/refresh-token lifecycle and CSRF strategy before replacing the current browser bearer-token flow.
3. Add login/reset rate limits, password reset, email verification policy, and audit events.
4. Migrate remaining tenant-owned CRM models (companies, pipelines, deals, and activities) to PostgreSQL with composite tenant constraints and isolation tests.
