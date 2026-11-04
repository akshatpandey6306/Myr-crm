# Render deployment

Render account/service creation and secret entry must be completed by an
authorized project owner. Use the repository root as the root directory for
each service.

## PostgreSQL

Create a Render PostgreSQL database and use its **internal** connection string
as `DATABASE_URL` on the API service. Keep the database in the same Render
region as the API.

## API web service

- Build command: `npm ci && npm run db:generate --workspace @myr-crm/api && npm run api:build`
- Start command: `npm run start --workspace @myr-crm/api`
- Pre-deploy command: `npm run db:deploy --workspace @myr-crm/api`
- Set `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN`, `PLATFORM_ADMIN_EMAILS`,
  `EMAIL_API_KEY`, and `EMAIL_FROM`.
- Set `WEB_ORIGIN` to the exact public origin of the Render web service. Use a
  verified sender address for `EMAIL_FROM` in the Resend account.
- Do not set `BILLING_TEST_MODE=true` in production.

The API listens on Render's `PORT`. Do not run `npm run db:seed` against a
production database.

## Web service

- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Set `API_PROXY_URL` to the API service URL followed by `/api/v1` (prefer the
  internal service URL when both services are in the same Render region).

The browser uses the same-origin `/api/v1` rewrite, so leave
`NEXT_PUBLIC_API_URL` unset unless intentionally changing that behavior.

## Before accepting customers

1. Confirm the pre-deploy migration succeeds and the API health endpoint returns
   `{"status":"ok"}`.
2. Verify signup, email verification, login, refresh, password reset, and
   workspace subscription gating using test accounts.
3. PayU checkout, payment verification, and webhooks are not integrated yet.
   The subscription page displays plan rates and PayU branding only; activation
   remains manual. Implement and test the complete payment flow before
   promising or accepting online payments.
4. Have Developer 2 review the interim organization-role policy and the
   remaining cross-module permissions.
