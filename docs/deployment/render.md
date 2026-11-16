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
3. New workspaces can start a free two-day trial. Online checkout, payment
   verification, and webhooks are not integrated; after a trial, activation
   requests are reviewed and fulfilled manually through the control panel.
4. Have Developer 2 review the interim organization-role policy and the
   remaining cross-module permissions.
