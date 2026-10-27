# Myr CRM

Myr CRM is a Next.js and TypeScript application. The first implemented screen is
the Developer 2 Activities & Tasks module.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validate

```bash
npm run lint
npm test
npm run build
```

## Activities & Tasks status

The screen currently demonstrates activity creation, completion, search,
status/assignee/related-record filters, due-date sorting, and local pagination
using sample data held in client-side memory. Its sample fields and enum values
follow the proposed activity contract. Refreshing the page resets changes.

The API, database persistence, server-side pagination, soft deletion,
authentication, and organization scoping are not implemented. The contract is
still provisional pending team agreement on auth and tenancy; integrate those
backend behaviors only after the shared conventions are confirmed.
