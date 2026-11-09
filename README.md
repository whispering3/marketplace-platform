# Market

An open-source marketplace application built with Next.js, React, TypeScript, PostgreSQL and Prisma. It includes catalog management, buyer and vendor accounts, orders, support, separate administrator and moderator workspaces, and an optional Monero wallet-RPC integration.

## Project status

**Experimental — not production-ready.** This repository is intended for learning, self-hosted evaluation and open-source collaboration. It has not received an independent security audit and must not be used to custody funds or process real payments without a full threat-model review, legal assessment and security testing.

The project does not endorse unlawful commerce. Operators are responsible for complying with the laws and regulations that apply to their jurisdiction and use case.

## Open source

Market is distributed under the [Apache License 2.0](LICENSE). Please read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Development

1. Install dependencies with `npm ci`.
2. Configure PostgreSQL and copy `.env.template` to `.env`, filling in environment values. Preserve an existing `.env`.
3. Run `npx prisma generate` and `npx prisma migrate deploy`.
4. Run `npm run dev` and open `http://localhost:3000`.

The PowerShell commands `npm run db:dev:start`, `db:dev:stop` and `db:dev:status` expect PostgreSQL 18 in `C:\Program Files\PostgreSQL\18` and an **already initialized** cluster in `.local-postgres/data` on port 55432. Otherwise, configure PostgreSQL separately and set `DATABASE_URL`.

Wallet operations require an available Monero wallet RPC. Seed commands modify accounts and data; use a disposable development database only.

## Validation

```sh
npx prisma validate
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` combines schema validation, TypeScript, lint, unit tests and build. `npm run test:integration` checks migrations, authentication, monetary precision, permissions, PINs, deposits, withdrawals and reservations in temporary local PostgreSQL; CREATE DATABASE permission is required. Tests do not send real transfers.

`npm run test:browser` uses disposable PostgreSQL and Playwright Chromium with JavaScript disabled. Install Chromium with `npx playwright install chromium`. `npm run prod:check` checks configuration, database and RPC using `.env.production`; prepare that environment first.

## Structure and operations

- `src/app`: pages, HTTP routes and server actions.
- `src/components`: shared components.
- `src/lib`: authentication, data access and business rules.
- `prisma`: schema, migrations and initialization scripts.
- `scripts`: checks and operational routines.
- `deploy`: Nginx, Tor and systemd samples.
- `public`: public assets used by the interface.

See the [single-onion production launch runbook](PRODUCTION_LAUNCH_SINGLE_ONION.md), [deployment architecture](DEPLOYMENT_AND_EXPANSION_STRATEGY.md), [wallet operations](WALLET_PRODUCTION_RUNBOOK.md), [onion hosting](ONION_HOSTING.md) and [staff setup](ADMIN_INIT.md).

The operational documents are reference material, not deployment approval. They contain placeholders only; never commit a real host name, onion address, database URL, private key, recovery phrase, wallet credential, administrator path or other production secret.

Preserve `.env`, `.env.production`, `.local-postgres` and local databases. `dev.db` is legacy SQLite, unused by the PostgreSQL client; review its contents before discarding it. `node_modules`, `.next` and `*.tsbuildinfo` are generated and ignored by Git. Dependencies are needed to run the project; `.next` contains the build for `npm start`. Keep `package-lock.json` for reproducible installations.

## Demonstration data

`npm run seed:demo` requires `ALLOW_DEMO_SEED=true`, a non-production environment and local PostgreSQL. Database names must begin with `market_demo`, `market_test`, `olympus_demo` or `olympus_test` (optional suffix allowed). `DEMO_DATABASE_NAME` must exactly match `DATABASE_URL`. The seed resets demonstration credentials and balances.

## Staff workspaces

Administrators use `/<ADMIN_URL_SECRET>`, with MSID, PIN and PGP verification. They manage accounts, finances, settings, infrastructure and moderation. The implementation is split into `src/app/staff-vault/page.tsx`, `data.ts`, `analytics.ts`, `navigation.ts` and `_components/panels.tsx`.

Moderators use `/moderator`, with separate navigation, listing review, support and disputed orders. `/moderator/verify` requires their own PIN and PGP signature. Existing accounts retain the database role `STAFF`. Administrators assign `products`, `orders` and `support` permissions; other legacy permissions do not grant administrative access. Support permission authorizes dispute settlement; orders exposes the dispute queue. The administrative URL redirects moderators to their own workspace.

Persisted monetary values use Decimal with 12 XMR decimal places. Some chart aggregates use numbers for presentation; settlement uses exact decimals. Read the wallet runbook before applying monetary migrations elsewhere.

## Hosting and costs

The plan proposes five servers: two active applications, primary database, database replica and a separate Monero server. Four or five application servers alone require seven or eight servers overall.

The hosting comparison covers IncogNET, 1984 Hosting, Njalla and Privex, using prices reviewed on September 13, 2026. Estimates are **US$365/month for five VPS**, or **US$313/month for four VPS and the currently available dedicated Monero option**, subject to stock and the documented assumptions. Mirror registration does not prove availability or configure load balancing. No servers have been purchased or deployed in this local work.

## Production checks

Authentication uses expiring, single-use, purpose-bound database challenges. PIN/PGP changes revoke sessions. Sentinel proofs are signed and CAPTCHA answer cookies encrypted. Wallet forms work without JavaScript, show reserved funds and retain the current mirror during redirects.

Corrected transitive versions of `deepmerge-ts`, `mysql2` and `esbuild` are pinned through `overrides`; review them when updating Prisma/tsx. Avoid automatic Prisma downgrades through `npm audit fix --force`.

- `npm test`: exact monetary conversions and Digest transport, including no timeout retry.
- `npm run test:integration`: authentication, concurrency, reservations, receipts and fees.
- `npm run test:browser`: actual browser flows against a disposable database.
- `npm run wallet:reconcile`: read-only cash/liability reconciliation against RPC.

Before accepting real funds, reconcile historical balances and validate the full financial cycle on stagenet. Local builds and tests alone do not establish production readiness.
