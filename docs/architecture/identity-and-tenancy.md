# Identity and Tenant Isolation Contract

**Status: Implemented foundation; Activities & Tasks MVP contract adopted (2026-10-31)**

This contract defines authentication, organization membership, and tenant-owned
CRM data. The Owner-approved interim role policy is enforced for the MVP.
Activities & Tasks follows the adopted contract in
[`role-permission-proposal.md`](role-permission-proposal.md); other module
contracts may still require review.

## Data model

- `User` represents one authenticated person; organization roles belong to
  memberships, not global users.
- `Organization` is the tenant boundary.
- A membership is unique per `(organizationId, userId)`. Organization creation
  and the creator's initial Owner membership are committed atomically.
- Customer Owner and Admin roles exist only within their organization
  membership. They do not grant platform control-panel access.
- The platform control panel is reserved for one existing active account,
  selected by `PLATFORM_ADMIN_EMAIL`. The legacy `PLATFORM_ADMIN_EMAILS`
  setting is accepted only if it resolves to one distinct address; multiple
  configured accounts fail closed.
- Tenant-owned CRM records carry a non-null `organizationId`.
- PostgreSQL/Prisma persist password hashes, password-reset token hashes,
  expiring invitation-token hashes, sessions, and shared rate-limit buckets.
- A partial unique index enforces at most one active Owner per organization.

## Authentication and API boundary

- The server derives `userId` from a verified server-side session. Request
  bodies, query parameters, and client state are never proof of identity.
- Browser authentication uses a seven-day HttpOnly, SameSite=Lax session
  cookie, Secure in production. Only the SHA-256 digest is persisted; the raw
  session value is not returned in JSON or browser storage.
- Password reset uses expiring, single-use tokens whose hashes are stored.
  Password resets revoke every active session for the user. Email verification
  is not required for account creation or access.
- Unsafe requests validate the configured `WEB_ORIGIN`; production
  cookie-authenticated mutations require the expected Origin.
- Authentication and invitation endpoints use PostgreSQL-backed rate limits.
- Production email uses SMTP for password reset, invitations, and CRM email.
  Development-only one-time links are logged locally when SMTP is not configured.
- Organization selection may be sent as an ID in the request context, but the
  API verifies active membership on every protected request.
- A customer workspace administrator can access that workspace's records and
  team according to their organization role, but cannot read another
  customer's records or member details by substituting an organization ID.
- Tenant-scoped queries and writes include the verified organization; a record
  ID alone is never sufficient authorization.
- Responses do not expose credentials, session secrets, or another
  organization's membership data.

Authentication routes include signup/login/logout/me and password-reset
request/confirm. Legacy email-verification resend/confirm routes remain for
previously issued links but do not gate access. Owner/Admin member management,
invitations, and assignee directory routes are documented in
[`../../apps/api/README.md`](../../apps/api/README.md).

## Tenant-isolation requirements

- Enforce membership and role checks in server-side authorization code, not
  only in the UI.
- Apply organization scope to reads, updates, archives, relationship lookups,
  search, pagination, and bulk operations.
- Validate that related records and assignment targets belong to the same
  organization before linking them.
- Derive organization scope from the verified membership context; a
  client-supplied `organizationId` is only a selector.
- Add database constraints and indexes for tenant-scoped uniqueness where
  applicable.
- Use consistent not-found/forbidden handling for inaccessible tenant records
  and test it across API routes.

## Required tests

- Unauthenticated requests cannot read or mutate protected identity or
  organization data.
- A user can access organizations where they have an active membership and
  cannot access another tenant by substituting its ID.
- Organization creation creates the organization and Owner membership
  atomically.
- Revoked or removed membership blocks subsequent requests.
- Tenant-scoped relationship validation rejects cross-organization links.
- Session cookies are HttpOnly and never exposed in JSON; cross-origin unsafe
  requests are rejected.
- Password reset consumes a token once and revokes existing sessions.
- Role administration preserves the active-Owner invariant.

## Remaining review items

- Select a production SMTP provider and configure credentials/TLS; delivery is
  synchronous and currently has no retry queue.
