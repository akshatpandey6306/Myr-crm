# Deploy LeadPilot to Render with Supabase

This deployment runs the Next.js web app and NestJS API inside one Render web
service. Supabase hosts PostgreSQL separately; no Render PostgreSQL service is
needed. The API listens only on the service's loopback interface, and Render
exposes the Next.js server on its assigned `PORT`.

## 1. Prepare Supabase

In the Supabase project dashboard, open **Connect** and copy the Session Pooler
connection string (port `5432`) for server-based Prisma deployments. Replace
its password placeholder with the database password. Keep the connection string
private. The local `.env` in this checkout currently points to `localhost`, so
do not bulk-import it as the Render database setting. Supabase documents the
Session Pooler as the IPv4-compatible option when direct connections are not
available; the Transaction Pooler is intended for serverless/short-lived
connections. [Supabase Prisma guide](https://supabase.com/docs/guides/database/prisma)

## 2. Create one Render web service

Connect the GitHub repository and select branch `mergetest`.

- Root directory: repository root
- Runtime: Node
- Build command:
  ```sh
  npm ci --include=dev && npm run db:generate --workspace @myr-crm/api && npm run api:build && npm run build
  ```
- Start command:
  ```sh
  npm run start
  ```
- Health check path: `/api/v1/health`

The API and web app must be built in the same service. Do not use `next start`
directly: it only starts the web process. The production `npm start` wrapper
starts the API on port `4000`, waits until it is listening, then starts Next.js
on Render's assigned `PORT`. Render sends public HTTP traffic to that `PORT` and
supports additional private ports within a web service. [Render web services](https://render.com/docs/web-services)

If your Render plan offers a pre-deploy command, set:

```sh
npm run db:deploy --workspace @myr-crm/api
```

Render runs the pre-deploy command before swapping in the new service version;
the feature is available on paid web services. On plans without it, run the
migration once from the Render Shell before the first release, then before each
schema-changing release. [Render deploy commands](https://render.com/docs/deploys)

## 3. Configure Render environment variables

Add these in **Render → service → Environment**. Do not commit them or put
server secrets in `NEXT_PUBLIC_*` variables.

```text
NODE_ENV=production
NODE_VERSION=22.16.0
DATABASE_URL=<Supabase Session Pooler connection string on port 5432>
API_PORT=4000
API_PROXY_URL=http://127.0.0.1:4000/api/v1
WEB_ORIGIN=https://<your-render-service>.onrender.com
PLATFORM_ADMIN_EMAIL=<existing active platform administrator email>
PARTNER_SECRET_ENCRYPTION_KEY=<64 hexadecimal characters>
```

For production PayU, add the rotated **live** credentials:

```text
PAYU_MODE=live
PAYU_MERCHANT_KEY=<live merchant key>
PAYU_MERCHANT_SALT=<live merchant salt>
PAYU_CALLBACK_URL=https://<your-render-service>.onrender.com/api/v1/billing/payu/return
```

Use your actual Render URL in both `WEB_ORIGIN` and `PAYU_CALLBACK_URL`. The
callback arrives at Next.js and its `/api/v1` rewrite forwards it to the local
NestJS API. `API_PROXY_URL` must be set during the build so the Next.js rewrite
targets the API in this same service. Leave `NEXT_PUBLIC_API_URL` unset. Never
use live credentials in sandbox mode or expose the salt in browser code.

Keep `PARTNER_SECRET_ENCRYPTION_KEY` stable after deployment. Generate it as 32
random bytes encoded as 64 hex characters; rotating it requires re-encrypting
stored partner secrets. Set SMTP variables too if this deployment should send
account onboarding and password-reset emails.

## 4. Deploy and check

1. Save the environment and deploy the service.
2. Review the build and deploy logs. Confirm `db:deploy` completed successfully.
3. Open `https://<your-render-service>.onrender.com/api/v1/health`; expect
   `{"status":"ok"}`.
4. Sign in, check the workspace modules, and open Subscription.
5. Use an authorized live plan checkout for any production payment check. It is
   a real charge. Confirm PayU returns to Subscription and the plan changes only
   after server-side `verify_payment` succeeds.

If a payment returns as pending, use the payment status recheck on Subscription.
Do not manually mark it successful. The API and web server both need to remain
up for callbacks and browser requests to work.

## First platform-admin account

Migrations create the schema, not a user. Production does not create the local
demo administrator. After rotating the Supabase database password and updating
the root `.env` `DATABASE_URL`, set `PLATFORM_ADMIN_EMAIL` there to the email you
want to use. From the repository root, bootstrap that one account with a
temporary PowerShell environment value (the password prompt is hidden):

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = 'you@example.com'
$env:BOOTSTRAP_ADMIN_NAME = 'Platform Administrator'
$secure = Read-Host 'Choose a strong platform-admin password' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:BOOTSTRAP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  npm.cmd run bootstrap:admin --workspace @myr-crm/api
} finally {
  Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secure.Dispose()
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_NAME -ErrorAction SilentlyContinue
}
```

The command creates or resets the configured active platform-admin user. It
does not create a workspace or assign a plan, and removes workspace memberships
from that platform-admin account. It requires `BOOTSTRAP_ADMIN_EMAIL` to match
`PLATFORM_ADMIN_EMAIL`. Set the same email as `PLATFORM_ADMIN_EMAIL` in
Render, save/redeploy, then sign in with the password you chose. Keep that
password in a password manager; it is not a Render environment variable.
