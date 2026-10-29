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


## Module 9 Activities & Tasks — implementation proposal

**Status: Provisional implementation on `feature/activities-tasks`; not an
agreed shared contract.** Review with the shared-contract owner before merging
or relying on its role and deletion policy.

### Fields and values

- Fields: `id`, `organizationId`, `type`, `title`, `description`, `status`,
  `priority`, `dueAt`, `completedAt`, `assignedToUserId`, `relatedToType`,
  `relatedToId`, `createdByUserId`, `createdAt`, and `updatedAt`. Responses
  also include assignee, creator, and related-record display names.
- `title` is required. `description`, `dueAt`, `assignedToUserId`,
  `relatedToType`, and `relatedToId` are optional/nullable.
- The server controls organization, creator, completion, and audit timestamps.
- `type`: `task | call | meeting | note | email`; `status`:
  `open | in_progress | completed | cancelled`; `priority`: `low | normal | high`.
- Related-record type and ID must be provided together or both null. Related
  records and assignment targets are validated within the active organization.

### Proposed API behavior

- `GET/POST /api/v1/activities` and
  `GET/PATCH/DELETE /api/v1/activities/:id`.
- Uses the shared bearer session and `x-organization-id` selector; the API
  verifies membership and scopes every operation to the selected organization.
- Lists accept `q`, `type`, `status`, `priority`, `assignedToUserId`,
  `relatedToType`, `relatedToId`, `page`, `pageSize`, `sortBy`, and
  `sortOrder`. Pagination defaults to page 1 / pageSize 25 (maximum 100);
  sorting supports `createdAt` and `dueAt`.
- Responses use `{ data: ... }` for a single record and
  `{ data: [...], meta: { page, pageSize, total, totalPages } }` for lists.
  Errors use `{ error: { code, message, details } }`.
- Set `completedAt` when status becomes completed and clear it when reopened.

### Decisions awaiting agreement

1. `DELETE` currently soft-archives the activity. Confirm archive versus
   permanent deletion.
2. The implementation provisionally mirrors the interim role matrix: Owner,
   Admin, and Sales Manager have organization-wide read/write/assign/archive
   access; Sales Representatives can read and update assigned activities and
   create activities assigned to themselves, but cannot reassign or archive;
   Read-only Users can read. Confirm or revise these rules.
3. Member selection is deferred until a shared organization-member endpoint
   exists; the UI currently assigns new activities to the signed-in member.

Do not treat the provisional role or deletion behavior as an agreed policy.
