# Monero wallet operations runbook

This document describes financial operations and their current limits. See [distributed architecture](DEPLOYMENT_AND_EXPANSION_STRATEGY.md) and [hosting budget](ONION_HOSTING.md).

## Required services

- PostgreSQL through `DATABASE_URL`, without a publicly exposed database port.
- A synchronized `monerod` and one active `monero-wallet-rpc` instance.
- `ADMIN_XMR_ADDRESS` where administrative payout flows use it.
- One deposit scheduler authorized with `WALLET_SYNC_SECRET`.

A spending wallet on a VPS is an online wallet. Sending funds to offline storage does not turn the VPS wallet into offline storage.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Private PostgreSQL connection |
| `ADMIN_XMR_ADDRESS` | Administrative payout destination |
| `XMR_RPC_URL` | Wallet RPC or validated local forwarding URL |
| `XMR_RPC_USER` / `XMR_RPC_PASS` | RPC credentials, outside code and logs |
| `WALLET_SYNC_SECRET` | Deposit routine authorization |
| `XMR_DEPOSIT_CONFIRMATIONS` | Required confirmations; defaults to 10 if invalid |
| `XMR_RPC_TIMEOUT_MS` | RPC call timeout |

See `.env.example` for names and formats. Do not use demonstration credentials operationally.

## Connectivity and authentication

The proposed financial host is separate from application and database servers. Restrict access using authenticated private networking and a firewall. Never expose wallet RPC as a public endpoint or disable authentication to work around integration errors.

Expose the wallet RPC only through a local authenticated tunnel on the financial worker. The web-facing application processes must not receive RPC credentials. Keep only the operational amount required for pending withdrawals in the online wallet, move reserves to offline storage, and require manual review for withdrawals above the operating threshold. Back up the wallet seed offline; never place it in environment files, application logs, database backups, or the repository.

The client negotiates HTTP Digest with qop auth. Local HTTP tests cover authentication and no retry after timeouts. Readiness checks still require localhost: use validated private local forwarding to the financial server. A real stagenet wallet remains to be validated. [Official authentication examples](https://docs.getmonero.org/rpc-library/wallet-rpc/).

## Preflight checks

`npm run prod:check` reads `.env.production` and checks configuration, database and RPC. Resolve authentication, synchronization and connectivity errors before accepting deposits or withdrawals. Passing this check does not replace a complete financial test cycle.

`/api/live` checks the process, `/api/health` checks application/database and `/api/health/wallet` checks RPC with Bearer `WALLET_SYNC_SECRET`. An RPC outage does not remove the web application from load balancing.

## Deposit synchronization

The scheduler can call `POST /api/wallet/sync` with an Authorization Bearer header containing `WALLET_SYNC_SECRET`. Never put the secret in the request URL. Local operational execution:

```sh
npm run wallet:sync
```

The scanner checks confirmations and uses the unique `txHash + address` key to prevent duplicate credits. Previously used addresses remain monitored. Confirmation count is configurable, not permanently fixed at ten.

Keep one scheduler active; web replicas must not independently start all financial routines. Monitor node/wallet height, synchronization lag, pending deposits, reserved balances and withdrawals requiring review.

## Backup and restoration

`npm run db:backup` uses PowerShell and `pg_dump`, writes a partial file first and reports success only after the process completes. Prisma-specific URL parameters are removed before calling PostgreSQL tools.

Restore with `npm run db:restore -- -BackupPath` followed by the backup path and `-TargetDatabaseUrl` followed by the target connection. **This replaces objects in the target**: validate in a separate database first. Restoration uses one transaction and stops on errors.

These scripts require PowerShell and PostgreSQL tools on PATH. Linux has `deploy/backup-postgres.sh`; install the required tools and configure scheduling, encryption and offsite copying at the destination.

Keep encrypted backups outside application servers and test restoration regularly. Database backups do not automatically include wallet files, wallet keys or onion identities; protect and rehearse their recovery separately.

Forward security and service logs to an append-only destination on a different host. Application security events contain categories, outcomes, opaque subject hashes and user IDs; they intentionally omit IP addresses, passwords, tokens, PGP content and wallet secrets. Restrict access to these logs and define a retention period before launch.

## Withdrawals and uncertain transfers

Approval paths use `src/lib/withdrawals.ts`. Balance reservations are serialized per user; approval and rejection compete through one conditional state transition.

- `AWAITING_APPROVAL`: balance reserved, awaiting a decision.
- `PROCESSING`: approval recorded before RPC; resending and refunds are blocked.
- `NEEDS_REVIEW`: uncertain outcome or accounting failure; funds remain reserved.
- `COMPLETED`: receipt and accounting entries committed.
- `REJECTED`: balance returned exactly once in a transaction.

In the administrator Wallets tab, use **Verify and reconcile** with a confirmed transfer hash. RPC must confirm destination and amount before accounting completes. A PROCESSING request less than five minutes old cannot be reconciled. No RPC response does not prove failure: do not reset the request or send again based on an assumption.

Unconfirmed outcomes remain reserved for investigation. There is no automatic refund for uncertain transfers. Moderators cannot access treasury operations, even if legacy wallet permissions remain on their accounts.

## Monetary migration

`20260912100000_exact_money_and_withdrawal_processing` converts monetary fields to `DECIMAL(30,12)`, preserves original text values in `MonetaryMigrationSnapshot` and adds withdrawal tracking fields. Conversion rounds to 12 decimal places; original values remain auditable. Duplicate withdrawal hashes block migration without deleting records.

Back up and validate restoration before deployment. Pause writes during conversion and release Decimal-compatible code with the migration. Do not run the previous application against the new schema. Audit snapshots do not replace full backups.

## Integration tests

`npm run test:integration` creates a randomly named temporary local PostgreSQL database, applies all migrations, checks preservation/concurrency/failures and removes only that database afterward. CREATE DATABASE permission is required. `TEST_DATABASE_URL` selects a local test server; otherwise the server from `DATABASE_URL` is used.

Tests use controlled transfer implementations, not the real wallet. They cover duplicate deposits and accounting failure after receipt of a withdrawal hash.

## Accounting and automatic payouts

`PlatformWallet.balanceXMR` is book cash: confirmed deposits increase it; outgoing principal and network fees decrease it. Purchases, escrow, fees, vendor activation and promotions are internal reclassifications and do not create cash. Revenue credited to the administrator remains a platform liability while held in that account balance.

Activation and promotion flows reserve administrator revenue in `WithdrawalRequest` in the same payment transaction. `sourceKey` identifies the payout; approval, transmission, receipts and recovery use the shared withdrawal service. There is no independent send followed by accounting without a reservation.

Run `npm run wallet:reconcile` with the destination environment loaded. It is read-only, uses exact values and returns failure on discrepancies. Investigate uncredited deposits, historical fees, external movements and changes between database/RPC snapshots. **Migrations do not recalculate historical cash or rewrite balances to hide differences.** Reconcile opening cash against the real wallet before launch.

## Scheduling and connection limits

`deploy/market-wallet-sync.service` and `.timer` run the scanner on the financial host. A PostgreSQL advisory lock prevents concurrent scans. Reserve at least two pool connections per process; the default is ten. Payment uniqueness continues to protect credits after interruption.
