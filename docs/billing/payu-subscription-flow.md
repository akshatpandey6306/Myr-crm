# PayU subscription checkout

## Customer flow

1. A workspace Owner or Admin selects a subscription plan and enters a phone
   number on `/subscription`.
2. The browser sends only the plan code, purchase type, and phone number to
   `POST /api/v1/billing/checkout`.
3. The API checks the authenticated workspace membership, plan availability,
   INR price, subscription state, and checkout eligibility. It creates a
   pending payment row and generates PayU's SHA-512 request hash with the
   server-only merchant salt.
4. The browser posts the returned form fields to PayU Hosted Checkout:
   `https://test.payu.in/_payment` in test mode or
   `https://secure.payu.in/_payment` in live mode.
5. PayU posts its success/failure response to
   `POST /api/v1/billing/payu/return`. The API checks the reverse hash and
   correlates the transaction ID, internal payment ID, product description,
   and amount against the saved payment. A browser callback alone never
   activates a subscription.
6. For a reported success, the API calls PayU `verify_payment` over HTTPS and
   requires the transaction ID, captured success status, exact INR amount, and
   PayU payment ID to match. The workspace plan, dates, and module entitlements
   update in a database transaction only after those checks pass.
7. The customer is returned to `/subscription?payment=…&transaction=…`. The
   page asks the authenticated API for the transaction status, refreshes the
   purchased plan after success, and offers a status recheck if PayU is still
   processing the transaction.

## Purchase rules

- Buying a plan or changing from an active plan charges the selected plan's
  configured INR price. The plan duration is set in whole days by the platform
  administrator. The new plan starts immediately after verification; this
  checkout does not prorate the old plan.
- A same-plan renewal is available during the final ten days and extends from
  the current expiry date.
- A different pending transaction can never activate a payment in another
  organization. Payment status reads require an Owner/Admin membership and are
  scoped to that authenticated workspace.

## API configuration

Keep these values in the API environment only:

- `PAYU_MERCHANT_KEY`
- `PAYU_MERCHANT_SALT`
- `PAYU_MODE=test` or `PAYU_MODE=live`
- `PAYU_CALLBACK_URL=https://<public-web-origin>/api/v1/billing/payu/return`
- `WEB_ORIGIN=https://<public-web-origin>`

The deployed public callback must route `/api/v1` to the NestJS API. For local
sandbox work, use the local API callback URL and test credentials. Never place
the salt in browser code, return it in an API response, or mix test and live
credentials. A live checkout charges real money and requires a publicly
reachable HTTPS callback.

## Operational boundary

The customer return handler and authenticated status endpoint perform PayU
verification. No PayU S2S payment webhook/outbox worker is currently configured;
if the browser never returns and PayU's redirect is lost, the payment may stay
pending until the workspace Owner/Admin rechecks it. Add a durable webhook
inbox/worker before claiming webhook-based reconciliation or unattended
recovery.

## PayU references

- [PayU Hosted Checkout integration](https://docs.payu.in/docs/prebuilt-checkout-page-integration)
- [PayU response hash handling](https://docs.payu.in/docs/working-with-response-after-a-customer-checkout)
- [PayU merchant integration endpoints](https://docs.payu.in/docs/apis-used-for-merchant-integration)
- [PayU payment webhooks](https://docs.payu.in/docs/webhook-events-and-sample-payloads)
