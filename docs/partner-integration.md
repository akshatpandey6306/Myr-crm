# CRM partner integration

All partner operations are server-to-server. Base API URL is `https://<crm-api-origin>/api/v1`. Never place a partner key or webhook secret in browser code. The Platform Admin creates a partner at **Control Panel → Partners**. Copy the generated API key and webhook signing secret once into the partner server's secret manager. Only the SHA-256 API-key digest and AES-256-GCM encrypted webhook secret are stored by the CRM.

Set `PARTNER_SECRET_ENCRYPTION_KEY` to 32 random bytes represented by 64 hexadecimal characters. Keep this stable and back it up securely; rotating it requires re-encrypting stored webhook secrets. API-key rotation revokes the previous active key. Permissions supported are `provision`, `customers:read`, and `subscriptions:write`.

`GET /partner/v1/health` checks a partner key and returns the CRM integration status.

## Provision a trial or paid customer

`POST /partner/v1/provision` requires `Authorization: Bearer <partner-api-key>` and an `Idempotency-Key` header.

```http
POST /api/v1/partner/v1/provision
Authorization: Bearer crm_partner_<secret>
Idempotency-Key: order-98374
Content-Type: application/json
```

```json
{
  "requestId": "req-98374",
  "externalCustomerRef": "customer-2841",
  "externalOrderRef": "order-98374",
  "externalSubscriptionRef": "partner-sub-98374",
  "purchaseType": "trial",
  "organization": { "name": "Acme", "timezone": "Asia/Kolkata" },
  "owner": { "name": "A. Customer", "email": "owner@example.com" },
  "plan": { "code": "starter" }
}
```

Use `purchaseType: "paid"` after the partner website has accepted the order. The CRM creates that organization with a `PENDING` subscription. A verified subscription webhook activates it after payment is confirmed. Trial requests start immediately for exactly 48 hours using the CRM UTC clock; trial eligibility is one time per normalized email across all partners. Duplicate request/order identifiers are idempotent only when their customer, plan, and purchase type match. Reusing them with different details returns `409`.

Example response:

```json
{
  "requestId": "partner:<partner-id>:req-98374",
  "status": "SUCCEEDED",
  "externalCustomerRef": "customer-2841",
  "organization": { "id": "<uuid>", "tenantId": "<uuid>", "slug": "acme-<suffix>", "loginUrl": "https://crm.example/sign-in" },
  "owner": { "userId": "<uuid>", "activationRequired": true },
  "subscription": { "status": "TRIAL", "planCode": "starter", "trialEndsAt": "<UTC ISO timestamp>" },
  "activationEmailSent": true
}
```

The activation link is emailed to the customer, is one time, and expires after one hour. The API never returns a permanent password or activation token. Retry activation email from the platform provisioning controls if delivery failed.

## Customer lookup

`GET /partner/v1/customers/{externalCustomerRef}` requires `customers:read` and returns only the workspace mapped to the authenticated partner. Unknown references return `404`.

## Signed subscription webhooks

Configure the partner's HTTPS webhook URL in the control panel and share the CRM generated signing secret with the partner server. Send JSON to `POST /partner/v1/webhooks/subscription` with:

- `X-CRM-Partner`: partner UUID shown in control panel.
- `X-CRM-Timestamp`: Unix timestamp in seconds, within five minutes of CRM time.
- `X-CRM-Signature`: `sha256=` followed by lowercase hex HMAC-SHA256 of `timestamp + "." + raw_request_body` using the signing secret.
- `eventId`: stable unique event identifier.
- `type`: one of `subscription.activated`, `.renewed`, `.upgraded`, `.downgraded`, `.cancelled`, `.expired`, `.suspended`, `payment.failed`.
- `externalCustomerRef` and `externalSubscriptionRef`: references for the linked customer and subscription. The CRM binds the subscription reference at provisioning or first verified event and rejects later mismatches.
- For activation/update, `planCode` and optional future ISO-8601 `periodEndsAt`.

```json
{
  "eventId": "evt-8372",
  "type": "subscription.activated",
  "externalCustomerRef": "customer-2841",
  "externalSubscriptionRef": "partner-sub-98374",
  "externalSubscriptionRef": "partner-sub-98374",
  "planCode": "starter",
  "periodEndsAt": "2027-11-15T00:00:00.000Z"
}
```

Node signing example:

```js
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify(event);
const signature = crypto.createHmac('sha256', webhookSecret)
  .update(`${timestamp}.`).update(body).digest('hex');
// Send exactly `body`, X-CRM-Timestamp: timestamp,
// X-CRM-Partner: partnerId, X-CRM-Signature: `sha256=${signature}`.
```

Successful responses include `{ "received": true, "duplicate": false, "outcome": "processed" }`. Repeated event IDs with the same body return the prior outcome without applying the change twice; reusing an event ID with a different body returns `409`. Invalid signatures, stale timestamps, and unmapped customer references are rejected. Failed payments and suspension set subscription access to pending; cancellations and expiration close access immediately. An activation uses the server-validated active plan's module entitlements.

## Platform controls and routes

The authenticated Platform Admin can create/enable/disable partners, configure permissions and HTTPS webhook/plans URLs, rotate/revoke keys and webhook secrets, inspect mapped customers, API usage, and recent webhook events, monitor provisioning requests, and extend an existing trial by 1–30 days through the audited subscription control. Workspace creation through the customer organization API is disabled; internal invitations remain unchanged. `/subscription` redirects into the CRM and no longer offers CRM-hosted checkout/trial entry. Expired or pending workspaces are gated by the API and show a blurred dashboard; when a partner plans URL is configured, the gate links to it. Data is retained after expiration.

Admin API routes (session authenticated and Platform Admin guarded): `GET/POST /control-panel/partners`, `PATCH /control-panel/partners/{partnerId}`, `POST /control-panel/partners/{partnerId}/status`, `POST /control-panel/partners/{partnerId}/keys/rotate`, `POST /control-panel/partners/{partnerId}/keys/{keyId}/revoke`, `POST /control-panel/partners/{partnerId}/webhook-secret/rotate`, and `GET /control-panel/partners/{customers|events|usage}`. The API records key-authenticated operation names and last-use timestamps; failed key and webhook authentication attempts are added to the platform audit log.

Run migrations with `npm run db:deploy`, generate Prisma with `npm run db:generate`, then start `npm run api:dev` and `npm run dev`.
