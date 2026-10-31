# CRM Audit Logs

`GET /api/v1/audit-logs` is available to Organization Owners and Admins. The
API derives the user and organization from the authenticated request and scopes
every result to that organization.

Optional query parameters:

- `page` and `pageSize` (default 1 and 25; maximum page size 100)
- `action`: `create`, `update`, or `archive`
- `resourceType`: case-insensitive partial match, up to 48 characters
- `actor`: case-insensitive partial match on actor name, up to 120 characters
- `from`: inclusive ISO date-time lower bound
- `to`: exclusive ISO date-time upper bound

Pagination metadata describes the filtered result set. Filters do not change
the audit event schema or capture request bodies.
