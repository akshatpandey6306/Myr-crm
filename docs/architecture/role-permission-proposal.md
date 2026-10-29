# Developer 1 Role and Permission Proposal

**Status: Developer 1 interim policy; review with Developer 2 when available**

This document records Developer 1's interim authorization matrix for the five roles named in the master CRM prompt. Developer 2 is unavailable, so the owner is using this policy for the persisted lead and contact APIs pending review. All access is limited to the active organization and enforced by the API; hiding a button in the frontend is not authorization.

## Scope definitions

- **All records** means all records belonging to the member's organization.
- **Assigned records** means records assigned to the member. A member may create a record and assign it to themselves or another authorized organization member.
- Organization IDs supplied by clients do not grant access. The server resolves the active organization from the authenticated user and verified membership.
- A related company, contact, lead, deal, pipeline, stage, or activity must belong to the same organization as the request context.

## Proposed matrix

| Capability | Organization Owner | Admin | Sales Manager | Sales Representative | Read-only User |
|---|---|---|---|---|---|
| View organization CRM records | All | All | All | Assigned | All |
| Create leads, contacts, companies, deals, activities | Yes | Yes | Yes | Yes | No |
| Update sales records | All | All | All | Assigned | No |
| Archive sales records | All | All | All | No | No |
| Assign sales records to members | Yes | Yes | Yes | No | No |
| Configure pipelines and stages | Yes | Yes | Yes | No | No |
| View and manage member accounts | Yes | Yes, except Owner | No | No | No |
| Invite members | Yes | Yes | No | No | No |
| Change organization settings | Yes | Yes | No | No | No |
| View audit history | Yes | Yes | No | No | No |
| Manage own profile and notification preferences | Yes | Yes | Yes | Yes | Yes |

## Role boundaries

- **Organization Owner:** Full organization control, including assigning or transferring ownership. The final Owner cannot be removed or deactivated until another Owner is assigned.
- **Admin:** Manages members, invitations, organization settings, and all CRM records. Admins cannot assign or remove the Owner role or transfer ownership.
- **Sales Manager:** Manages organization-wide sales records, assignments, pipelines, and stages. Cannot manage members, roles, or organization security settings.
- **Sales Representative:** Creates records and works with assigned records. Cannot archive records, configure pipelines, or change member access.
- **Read-only User:** Reads organization CRM records and manages only their own profile and preferences.

## Enforcement requirements

1. Deny access by default and check both membership and permission on every protected API operation.
2. Apply organization scoping to reads, writes, search, pagination, exports, nested relations, and background jobs.
3. Validate assignment targets and every related-record ID against the same organization.
4. Prevent removal or deactivation of the last Owner or other final organization administrator.
5. Audit role changes, invitations, member deactivation, ownership changes, and organization-setting changes. Exclude credentials, tokens, and secrets from audit data.
6. Verify cross-organization read, update, archive, assignment, and relationship attempts before release.

## Decisions for team review

- Interim choice: Sales Representatives can view and update only records assigned to them. New records are assigned to their creator; assignment management is a follow-up API.
- Interim choice: Sales Managers can configure pipelines and stages.
- Interim choice: Owners, Admins, and Sales Managers may archive sales records.
- Confirm whether additional fine-grained permissions are required for the MVP.

Do not implement this matrix until both developers agree on the scope and decisions above.


## Module 9 Activities & Tasks — Developer 2 proposal

**Status: Proposed by Developer 2; confirm before treating as the shared contract.**

Developer 2 reports that their Activities & Tasks screen is on local main with uncommitted changes, currently uses demo data, and has no backend routes or dedicated branch/PR. Coordinate integration after a branch or PR is available; do not assume the work is present in this Codespace checkout.

### Fields and values

- Fields: id, organizationId, type, title, description, status, priority, dueAt, completedAt, assignedToUserId, relatedToType, relatedToId, createdByUserId, createdAt, updatedAt.
- title is required. description, dueAt, assignedToUserId, relatedToType, and relatedToId are optional/nullable.
- Server-managed fields: id, organizationId, createdByUserId, completedAt, createdAt, and updatedAt.
- type: task | call | meeting | note | email; status: open | in_progress | completed | cancelled; priority: low | normal | high. Map the current UI's Medium priority to normal; Developer 2 offers to add note support to the UI.
- Related-record type and ID must be supplied together or both null. The server verifies the related record belongs to the user's organization.

### Proposed API behavior

- GET/POST /api/activities and GET/PATCH/DELETE /api/activities/:id.
- PATCH accepts only user-editable fields; organization and audit fields remain server-controlled.
- Set completedAt when status becomes completed and clear it when reopened.
- Require authentication and verified organization membership. Resolve organization scope on the server; validate related records and assignment targets within that organization.
- Use the agreed JSON error shape: { "error": { "code": "...", "message": "...", "details": ... } }, with standard HTTP status codes.

### Open questions before implementation

1. Does DELETE permanently delete an activity or soft-delete/archive it?
2. Are pagination and filters included in the initial list route? If so, agree the parameter names, defaults, limits, and response metadata.

Keep this contract provisional until these two questions and the shared auth/tenancy integration point are confirmed.
