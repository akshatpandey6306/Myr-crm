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

The screen currently demonstrates task and activity creation, completion,
search, status filtering, and due-date sorting using sample data held in
client-side memory. Refreshing the page resets changes. There is no API,
database persistence, authentication, or organization scoping yet; these need
to be integrated with the shared backend foundations before the module is
considered complete.
