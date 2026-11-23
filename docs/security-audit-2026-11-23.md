# CRM security and reliability audit

**Reviewed:** 2026-11-23

**Scope:** repository source, API authorization and input handling, browser security policy, local environment-file handling, dependency versions, automated tests, and production builds.

## Changes made

- Moved password scrypt derivation from synchronous calls to Node's asynchronous crypto API. Existing stored hashes keep the same `scrypt$salt$hash` format; verification rejects malformed encodings and compares hashes in constant time. Password hashing in signup, reset, activation, imports, provisioning, and admin bootstrap now uses the asynchronous helper. This keeps expensive password work off the main event loop.
- Performs employee-import password derivation before opening its write transaction, then revalidates within the transaction. This avoids holding a database transaction/connection while deriving up to 500 hashes.
- Added database-backed rate limits for lead, contact, and employee imports, email creation, and dashboard/report summaries. These complement existing login, signup, and billing limits.
- Made production CORS/CSRF origin configuration fail closed: `WEB_ORIGIN` must be configured and HTTPS in production instead of silently accepting localhost.
- Added a per-response nonce Content Security Policy in the Next proxy, while retaining its existing unauthenticated-route redirect and public-asset behavior. The root layout is request-rendered so Next can attach matching nonces to scripts; this trades static rendering for nonce-based script protection.
- Added `Cache-Control: no-store` on API responses and made HSTS production-only in Next configuration.
- Declared Node.js `^24.15.0` in the package manifest and lockfile because the installed `jsdom` requires at least 24.15 on the Node 24 line; this lets Render select a supported version from `engines`.
- Removed the tracked stale `auth.controller.ts.bak` file.
- Added regression coverage for password hashing/legacy hash compatibility, import limits, production origin validation, and nonce CSP plus auth redirects.

## Existing protections reviewed

- API-wide authentication and organization-context guards are already present. Module authorization, employee role restrictions, workspace isolation, and record ownership have dedicated tests across CRM modules.
- Sessions use HttpOnly cookies and server-side token digests. Passwords are stored as salted scrypt hashes.
- CORS allows only the configured web origin; unsafe cookie requests have origin checks. API routes use Prisma, and reviewed source contained no `dangerouslySetInnerHTML`, direct `innerHTML` assignment, or `eval()` usage.
- `.env` is ignored by Git and is not tracked in the current branch history; `.env.example` contains blank secret values. The local `.env` was not printed or added to this change.
- The audited lockfile currently resolves Next 16.4.6 and React 19.3.1. The Multer 2.5.0 override is retained. No blind dependency upgrades were made.

## Deployment and follow-up items

1. Set `WEB_ORIGIN` to the deployed frontend's exact HTTPS origin in the API service. The application now intentionally fails at startup if production origin configuration is missing or insecure.
2. Configure `TRUST_PROXY_HOPS` to match the actual trusted ingress chain before relying on per-IP rate limits in Render. Render documents that requests pass through its load balancer and Cloudflare; the hop count must match the deployed path and must not be guessed. [Render web services](https://render.com/docs/web-services) · [Render client IP and rate limiting](https://render.com/articles/how-render-handles-ddos-attacks).
3. Enable MFA for privileged users; the application does not currently provide MFA.
4. Verify database credentials use a least-privilege application role, TLS, managed backups, and production migration procedures. These account/provider settings cannot be confirmed from repository source alone.
5. Run a complete dependency advisory scan when the npm registry is reachable. `npm audit --omit=dev --audit-level=moderate` could not reach `registry.npmjs.org` in this environment (`ENOTFOUND`), so a complete online vulnerability report is unavailable.
6. Run staging browser, API load, and end-to-end authorization checks against the deployed services. No live database or Render service was exercised during this local audit.
7. Rotate any credential that has ever been shared outside the ignored local `.env`, even though no secret was found in the checked branch history.
8. The local audit shell is on Node 24.14.1, below the declared minimum. Upgrade the local Node 24 installation to 24.15 or newer before reinstalling dependencies; the production build and tests did pass on 24.14.1, but npm previously reported engine warnings.

## Verification

- API tests: 245 passed, 0 failed.
- Frontend tests: 41 passed, 0 failed; focused proxy/CSP tests: 4 passed, 0 failed.
- API TypeScript typecheck and production compilation passed.
- Frontend TypeScript typecheck and optimized production build passed. The build confirms all routes are dynamically rendered to support per-response CSP nonces.
- Secret search covered tracked history and common credential patterns. No dedicated Gitleaks/TruffleHog scan was available, so this is not a guarantee that every possible secret format is absent.
