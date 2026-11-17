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
- Set `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN`,
  `PLATFORM_ADMIN_EMAIL`, and `PARTNER_SECRET_ENCRYPTION_KEY`.
- Generate `PARTNER_SECRET_ENCRYPTION_KEY` as 32 random bytes encoded as 64
  hexadecimal characters. Keep it stable and backed up; rotating it requires
  re-encrypting stored partner webhook secrets and provisioning credentials.
- Set `PLATFORM_ADMIN_EMAIL` to the email address of the one existing active
  account that should manage the platform. Production does not create the local
  seeded demo-admin account. Do not configure multiple platform administrators.
- Set `WEB_ORIGIN` to the exact public origin of the Render web service.
- For PayU sandbox, set the sandbox `PAYU_MERCHANT_KEY` and
  `PAYU_MERCHANT_SALT`, set `PAYU_MODE=test`, and set
  `PAYU_CALLBACK_URL=https://myr-crm-web.onrender.com/api/v1/billing/payu/return`.
  This public web URL routes the callback through the web service's API rewrite.
  The checkout redirects the browser to PayU Hosted Checkout. The API validates
  PayU's callback hash and order fields, then calls PayU `verify_payment`; only
  a matching captured transaction activates or changes the workspace plan.
  After returning to `/subscription`, an Owner/Admin can recheck a pending
  transaction through the authenticated, organization-scoped payment-status
  endpoint. Never activate a plan from the browser redirect alone.
- For live PayU payments, replace both credentials with the live merchant key
  and salt, set `PAYU_MODE=live`, and keep
  `PAYU_CALLBACK_URL=https://myr-crm-web.onrender.com/api/v1/billing/payu/return`.
  Confirm the web service's `/api/v1` rewrite points to the deployed API and
  that the API service's `WEB_ORIGIN` is `https://myr-crm-web.onrender.com`.
  Remove `PAYU_TEST_TRIAL_AMOUNT` for live operation. Keep the salt only in the
  API service. Do not use live credentials with `PAYU_MODE=test` or vice versa.
- For local development, use
  `PAYU_CALLBACK_URL=http://localhost:4000/api/v1/billing/payu/return` and
  `PAYU_MODE=test`. `PAYU_TEST_TRIAL_AMOUNT=1.00` is an optional sandbox-only
  override; remove it before switching to live credentials and `PAYU_MODE=live`.
The API listens on Render's `PORT`. Do not run `npm run db:seed` against a
production database.

Email delivery is disabled for now. Deploy only the API and web services; no
SMTP credentials, delivery token, or separate email service are required.

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
2. Verify workspace signup approval, teammate join requests, login, and
   workspace subscription gating using test accounts.
3. Complete a PayU sandbox checkout and verify that the callback returns to the
   subscription page and that the API confirms the transaction before enabling
   a plan. PayU's `verify_payment` request and callback hash verification run on
   the API; never move the merchant salt into browser settings.
4. Have Developer 2 review the interim organization-role policy and the
   remaining cross-module permissions.
