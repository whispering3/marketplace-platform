# Production launch with one primary onion address

This guide describes the first production launch with **one public onion address and no public mirrors**. The application, PostgreSQL, and the Monero wallet remain separate operational responsibilities. A database replica is optional and is not a public website mirror.

Complete every validation in staging before accepting real funds. The commands assume an updated Debian or Ubuntu server, systemd, Nginx, Tor, PostgreSQL client tools, Node.js 22.12+ or Node.js 24, and a non-root service account named `market`.

## Recommended service plan

Price reference checked on **September 13, 2026**. Stock, advance billing, exchange rates, taxes, and XMR amounts may change before payment. Confirm resources and billing periods during checkout.

| Item | Initial plan | Purpose | Reference cost |
| --- | --- | --- | ---: |
| Application VPS | IncogNET, 4 GB RAM, 2 vCPU, 50 GB NVMe | Next.js, Nginx, and the primary onion service | USD 20.00/month |
| Database VPS | IncogNET, 8 GB RAM, 2 vCPU, 90 GB NVMe | Primary PostgreSQL database | USD 36.00/month |
| Financial VPS | 1984 VPS #5, 16 GB RAM, 6 CPU, and 320 GB | Pruned `monerod`, wallet RPC, and synchronizer | USD 154.56/month |
| Additional financial storage | 1984, additional 100 GB | Raises node storage to 420 GB raw | USD 30.00/month |
| External backup and monitoring | Allowance for off-database storage and an external probe | Encrypted dumps, alerts, and retention | USD 20.00/month |
| **Estimated monthly base** |  |  | **USD 260.56/month** |
| 15% operating reserve | Price variation, growth, and minor expenses |  | **USD 39.08/month** |
| **Recommended monthly budget** |  |  | **approximately USD 300/month** |

IncogNET plans may require six months of advance payment. If both plans are billed for six months, reserve **USD 336 for the initial order**: USD 120 for the application and USD 216 for the database. This does not change the monthly equivalent of USD 56. 1984 publishes prices in USD and XMR; the XMR amount is recalculated using the current rate.

Under this scenario, the estimated initial payment is approximately **USD 540.56**: six prepaid months for both IncogNET VPS plans, the first month of the financial server, and USD 20 reserved for backup and monitoring. Taxes, currency spread, Monero network fees, administration work, wallet liquidity, incidents, and storage expansion are excluded. Never use customer operating balances to pay infrastructure costs.

Confirm these sources before purchasing:

- [IncogNET KVM VPS](https://incognet.io/kvm-vps): 4 GB application and 8 GB database plans; the provider states that XMR is accepted.
- [1984 Hosting VPS](https://1984.hosting/product/pricelist/): VPS #5 and 100 GB expansion; the provider publishes XMR prices.
- [Privex dedicated servers](https://pay.privex.io/order/choose-server): an alternative for the Monero server. During the September 13, 2026 review, the USD 85 plan was out of stock; the available 64 GB model with `2 x 512 GB NVMe` cost USD 140/month plus a USD 70 setup fee. Confirm payment methods, RAID, and usable capacity before replacing 1984.

### Provider separation alternative

Hosting the application and database with one provider creates a shared commercial dependency even in different locations. To reduce this concentration, use the USD 20 IncogNET application server and the 1984 VPS #4 database server with 8 GB RAM and 160 GB for USD 77.28/month. With the 1984 financial server and USD 20 for backup and monitoring, the base becomes **USD 301.84/month**, or approximately **USD 347/month** with a 15% reserve.

This alternative still places the database and financial server with 1984. Full separation requires a tested third provider. Evaluate acceptable-use terms, registration data requirements, payment methods, availability history, and support for the intended service.

### Services to purchase

1. One VPS for the application and primary onion service.
2. One VPS for PostgreSQL.
3. One VPS or dedicated server for the Monero node and wallet RPC.
4. External storage or a small VPS in another failure domain for encrypted backups.
5. An external monitoring probe with Tor access. It may initially share the backup machine when isolation and capacity are sufficient.

A traditional DNS domain, CDN, commercial TLS certificate, and DNS service are unnecessary for an onion-only deployment. Tor generates the v3 address. PostgreSQL, Tor, Nginx, Node.js, WireGuard, systemd, Monero, and Uptime Kuma are free software, but operation, patching, and incident response still have costs.

## Complete roadmap from local development to production

The durations below are planning estimates. Advance only after recording the required exit evidence.

| Phase | Estimated duration | Required result |
| --- | ---: | --- |
| 0. Launch definition | 1 day | Frozen scope, owners, budget, and blocking criteria |
| 1. Local audit and release candidate | 1-2 days | Passing tests, audited dependencies, and identified release commit |
| 2. Procurement and inventory | 1-3 days | Available servers, recoverable access, and complete inventory |
| 3. Private network and hardening | 1-2 days | Minimal public ports and verified private communication |
| 4. Database and backups | 1-2 days | Migrations applied in staging and tested restoration |
| 5. Monero on stagenet | 2-7 days plus initial synchronization | Synchronized node and verified financial lifecycle |
| 6. Application deployment | 1 day | Locally validated blue/green deployment, health checks, and rollback |
| 7. Primary onion | 1 day | Preserved address and successful external Tor navigation |
| 8. Operational acceptance | 1-3 days | Approved critical flows, reconciliation, alerts, and runbooks |
| 9. Controlled launch | 1 day | Production active with initial limits and continuous observation |
| 10. Stabilization | 7-14 days | Stable metrics, valid backups, and reviewed incidents |

Allow **two to three weeks** between procurement and the controlled launch under normal conditions. Initial Monero synchronization, staging fixes, and provider availability may extend the schedule.

### Phase 0: define the launch

- Confirm that only one public onion address will be used.
- Freeze first-release features and reject nonessential changes.
- Assign ownership for the application, database, wallet, administrative PGP, and backups.
- Approve the monthly limit and initial payment.
- Define initial deposit, balance, withdrawal, and order-volume limits.
- Define launch blockers: failing tests, unexplained balances, an untested restoration, public RPC, default secrets, or no rollback path.

**Exit evidence:** recorded scope, owners, budget, financial limits, and formal decision to proceed.

### Phase 1: close the release candidate

- Review Git status and separate release files from local artifacts.
- Run `npm ci`, Prisma generation, `npm run check`, integration tests, browser tests, and dependency auditing.
- Review migrations and confirm that they are additive or have an explicit maintenance plan.
- Review `.env.example` without copying real values.
- Build one Linux artifact and record its release SHA.
- Freeze the approved artifact. Do not rebuild it differently on each server.

**Exit evidence:** all tests pass, the artifact is reproducible, and its SHA is recorded.

### Phase 2: procure and inventory

- Purchase the application, database, financial, and backup services.
- Select regions with acceptable private latency and avoid unnecessary reliance on one machine.
- Create provider accounts with independent credentials and protected recovery methods.
- Record provider, plan, region, private IP, renewal date, paid period, support contact, and responsible operator.
- Confirm acceptable-use terms before transferring data or funds.

**Exit evidence:** complete inventory and administrative access tested through a recovery channel.

### Phase 3: prepare the operating system and network

- Update the operating system and enable planned security updates.
- Create non-root users, SSH key authentication, and minimal `sudo` rules.
- Disable SSH password authentication and direct remote root login after confirming key access.
- Configure the firewall with only restricted administrative SSH and necessary ports. PostgreSQL and wallet RPC must never be public.
- Create WireGuard or another authenticated private tunnel between application, database, and financial servers.
- Configure time synchronization and log limits.
- Test tunnel failure and recovery without temporarily opening public ports.

**Exit evidence:** an external scan cannot reach PostgreSQL or wallet RPC, and the application reaches both only through the private path.

### Phase 4: prepare the database and data protection

- Create a dedicated PostgreSQL role and database with the least required privileges.
- Configure TLS or an authenticated tunnel, connection pooling, and timeouts.
- Restore a copy in staging and apply every migration.
- Run the test suite against the staging database.
- Install automatic encrypted backups with retention and an external copy.
- Perform a full restoration into another database and measure the duration.
- Document the tested recovery point objective and recovery time objective.

**Exit evidence:** approved migrations and a proven restorable backup with recorded time and result.

### Phase 5: prepare Monero and test financial flows

- Verify signatures or hashes of Monero binaries downloaded from the official source.
- Synchronize `monerod`, monitor storage, and validate node height.
- Create wallet RPC credentials with `--rpc-login` and bind the service to loopback.
- Store the seed, restore height, and wallet backup outside the servers.
- Configure exactly one active spending wallet and one deposit synchronizer.
- On stagenet, test deposits, confirmations, single credit, reservation, withdrawal approval, fees, receipts, timeouts, and reconciliation.
- Simulate RPC unavailability and verify that uncertain withdrawals are never sent twice.

**Exit evidence:** a stagenet report covering every financial transition with no reconciliation difference.

### Phase 6: install and validate the application

- Create blue and green release directories and install systemd units.
- Install the approved artifact and protected environment file.
- Apply migrations exactly once.
- Start blue on loopback and validate `/api/live` and `/api/health`.
- Install Nginx on loopback, verify limits and headers, and run `nginx -t`.
- Start green, switch upstream, test it, and switch back to prove rollback.
- Confirm that logs contain no passwords, PINs, keys, seeds, tokens, or private messages.

**Exit evidence:** a healthy supervised application with a tested blue/green rollback.

### Phase 7: publish the primary onion service

- Create one `HiddenServiceDir` and forward onion port 80 to Nginx at `127.0.0.1:8080`.
- Copy the generated hostname to `ONION_URL` and `SERVER_ACTION_ALLOWED_ORIGINS`.
- Keep `PUBLIC_ONION_MIRRORS` empty.
- Restart the application after changing the environment.
- Create an encrypted backup of the onion identity and test its restoration in an isolated environment.
- Browse from another machine with Tor Browser and check forms, redirects, and the absence of internal hosts.

**Exit evidence:** only the primary address is published, and every flow remains on that onion host.

### Phase 8: operational acceptance

- Create the administrator, remove `SETUP_KEY`, and confirm that bootstrap cannot be reused.
- Validate the separation between administrator and moderator panels.
- Run `npm run prod:check` and `npm run wallet:reconcile` in the final environment.
- Complete the acceptance checklist below.
- Configure alerts for processes, database, wallet, disk, timer, backup age, and authentication failures.
- Rehearse database restoration, release switching, tunnel loss, and wallet recovery without real funds.
- Require a two-person final review of addresses, amounts, secrets, and financial limits.

**Exit evidence:** signed checklist, no financial differences, and a documented launch decision.

### Phase 9: controlled launch

- Take a final backup and record the release and migration versions.
- Begin with low limits and gradually admit users when possible.
- Monitor logs, errors, latency, connections, synchronization, and queues in real time.
- Manually reconcile the first deposits and withdrawals with RPC and accounting records.
- Suspend new financial operations after any uncertain result.

**Exit evidence:** the first operations reconcile and no critical issue remains open.

### Phase 10: stabilize and plan expansion

- Review health, disk, backups, pending withdrawals, and differences daily.
- Perform periodic restorations and record the measured duration.
- Apply system and dependency patches in staging before production.
- Review incidents and adjust alerts, capacity, and limits.
- After 7-14 stable days, choose between a PostgreSQL replica and a second application server. For this project, add the database replica before a public mirror.
- Add a mirror only in another failure domain, using the same artifact and independent tests.

**Exit evidence:** an operational baseline, maintenance calendar, and approved next expansion.

## Detailed technical procedure

### 1. Choose the initial topology

Use three servers to maintain the recommended minimum separation:

| Server | Public exposure | Responsibility |
| --- | --- | --- |
| Application | Tor only | Tor, Nginx, and the Next.js application |
| Database | Private network only | Primary PostgreSQL and encrypted backups |
| Financial | Private network only | `monerod`, one active `monero-wallet-rpc`, and deposit synchronization |

The application is the only server that publishes an onion service. PostgreSQL and wallet RPC must reject public traffic. Use an authenticated private network or SSH tunnel between servers. Combining services can reduce initial cost but increases the impact of a server failure and is not recommended for financial production.

Record private addresses, firewall rules, operating-system versions, and the responsible operator before installation.

### 2. Prepare backups and secrets

Before changing an existing database, create a backup and restore it into another test database. Keep encrypted copies outside the application server. Back up Monero wallet files, recovery material, and onion-service identity separately; a PostgreSQL dump contains none of them.

Generate independent random values on a trusted administrative machine:

```sh
openssl rand -base64 64   # SESSION_SECRET
openssl rand -base64 48   # AUTH_SALT
openssl rand -base64 48   # SETUP_KEY
openssl rand -base64 48   # WALLET_SYNC_SECRET
openssl rand -base64 32   # NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
openssl rand -hex 24      # ADMIN_URL_SECRET
```

Generate strong independent RPC credentials. Store secrets in the deployment secret manager or root-owned environment files with `0600` permissions. Never place real values in Git, tickets, shell history, or documentation.

### 3. Prepare PostgreSQL

Use separate PostgreSQL roles for schema migrations and application runtime. The runtime role must not own the database, create roles, or change the schema. After migrations, apply the included grant policy as the database owner:

```sh
psql "$MIGRATION_DATABASE_URL" \
  -v migration_role=olympus_migration \
  -v runtime_role=olympus_app \
  -f deploy/postgresql-least-privilege.sql
```

Set `DATABASE_URL` to the runtime role and load `MIGRATION_DATABASE_URL` only in the controlled migration job. Backups should use a separate read-only backup role. Keep PostgreSQL on a private interface and allow connections only from the application and financial hosts.

Create a dedicated database and role with only the privileges required by the application. Bind PostgreSQL to the private interface and accept connections only from application and financial servers. Require encrypted transport whenever traffic crosses servers.

Use a production connection URL similar to:

```text
postgresql://APP_USER:URL_ENCODED_PASSWORD@PRIVATE_DB_HOST:5432/olympus_db?schema=public
```

Test the connection from the application server with `psql`, then confirm that port 5432 is unreachable from public networks. Configure automatic encrypted dumps, retention, and transfer to external storage. The repository includes `deploy/backup-postgres.sh`; provide `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSFILE` outside the script.

### 4. Prepare the Monero server

Install and fully synchronize `monerod`. Use a pruned node for this capacity plan and reserve space for blockchain growth, logs, and wallet files. Create the spending wallet through a controlled process and document restoration before adding funds.

Run exactly one active `monero-wallet-rpc` instance for the spending wallet. Enable RPC authentication, bind it to loopback, and expose it to the application only through authenticated private forwarding. The production readiness check intentionally rejects a public or non-local `XMR_RPC_URL`.

Create local forwarding on the application server so the environment can use:

```text
XMR_RPC_URL=http://127.0.0.1:18082/json_rpc
```

Confirm that RPC is inaccessible from the public internet. Test the complete deposit, confirmation, withdrawal, uncertain-transfer, and reconciliation lifecycle on stagenet before funding a production wallet.

### 5. Install the application release

Create the service account and release directories:

```sh
sudo useradd --system --home /srv/market --shell /usr/sbin/nologin market
sudo install -d -o market -g market /srv/market/blue /srv/market/green
sudo install -d -o root -g market -m 0750 /etc/market
```

Build one Linux-compatible artifact in a trusted environment. Build and runtime must use the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` and `DEPLOYMENT_ID`. Install locked dependencies and validate the source:

```sh
npm ci
npx prisma generate
npm run check
npm run test:integration
npm run test:browser
npm audit --audit-level=high
```

Copy the validated release to `/srv/market/blue`. Set `market:market` ownership, allow that account to write `.next/cache`, and retain the previous release in `/srv/market/green` for rollback. Never copy development `.env` files into production.

### 6. Create the production environment

Create `/etc/market/app.env` with real values required by `.env.example`. For the initial single-onion launch, use this public-host pattern:

```dotenv
NODE_ENV=production
ONION_URL=http://PRIMARY_V3_ADDRESS.onion
PUBLIC_ONION_MIRRORS=
SERVER_ACTION_ALLOWED_ORIGINS=PRIMARY_V3_ADDRESS.onion

DATABASE_URL=postgresql://APP_USER:URL_ENCODED_PASSWORD@PRIVATE_DB_HOST:5432/olympus_db?schema=public
DATABASE_POOL_MAX=10

SESSION_SECRET=GENERATED_SECRET
AUTH_SALT=GENERATED_SECRET
SETUP_KEY=GENERATED_ONE_TIME_SECRET
ADMIN_URL_SECRET=GENERATED_SECRET_PATH
ADMIN_MSID=PRIVATE_ADMIN_IDENTIFIER
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=GENERATED_32_BYTE_BASE64_VALUE
DEPLOYMENT_ID=RELEASE_COMMIT_SHA

ADMIN_XMR_ADDRESS=VALID_ADMIN_MONERO_ADDRESS
XMR_RPC_URL=http://127.0.0.1:18082/json_rpc
XMR_RPC_USER=GENERATED_RPC_USER
XMR_RPC_PASS=GENERATED_RPC_PASSWORD
XMR_DEPOSIT_CONFIRMATIONS=10
XMR_RPC_TIMEOUT_MS=10000
WALLET_SYNC_SECRET=GENERATED_SECRET
```

Use the 56-character v3 hostname generated by Tor. Do not add fictional mirror addresses. `SERVER_ACTION_ALLOWED_ORIGINS` takes a hostname without a path. Configure all other variables required by `.env.example`, then protect the file:

```sh
sudo chown root:market /etc/market/app.env
sudo chmod 0640 /etc/market/app.env
```

Create `/etc/market/blue.env` with `PORT=3000` and `/etc/market/green.env` with `PORT=3001`, using the same ownership and permissions.

### 7. Apply migrations exactly once

Stop application writes, confirm that the latest backup can be restored, load the production environment, and run:

```sh
npx prisma migrate status
npx prisma migrate deploy
```

Run migrations from one process and one release only. Never start several instances that may compete over schema changes. Review the result and confirm that `MarketConfig` contains the `global_config` record before readiness checks.

### 8. Install systemd and Nginx

Copy `deploy/market-app@.service` to `/etc/systemd/system/market-app@.service`. Install `deploy/nginx-blue-green.conf` as an Nginx server configuration. It listens only on `127.0.0.1:8080`; Tor is the public entry point.

Validate and start blue:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now market-app@blue
curl --fail http://127.0.0.1:3000/api/live
curl --fail http://127.0.0.1:3000/api/health
sudo nginx -t
sudo systemctl reload nginx
```

Keep upstream selection controlled by server configuration. Never accept a client header to select blue or green. For a future switch, start the inactive release, test its health directly, update the server-controlled upstream, run `nginx -t`, reload Nginx, and keep the prior process available for rollback.

### 9. Create the single onion service

Install Tor and add the equivalent of `deploy/torrc-onion-service.sample`:

```text
HiddenServiceDir /var/lib/tor/market/
HiddenServiceVersion 3
HiddenServicePort 80 127.0.0.1:8080
```

Ensure that the Tor service owns and can access `HiddenServiceDir`, then restart Tor. Read the generated `hostname` file as root, set that hostname in `ONION_URL` and `SERVER_ACTION_ALLOWED_ORIGINS`, and restart the application.

Securely back up the hidden-service identity. Losing it changes the public address; exposing it permits impersonation. Do not create or publish additional hidden-service directories during the initial launch.

From another machine using Tor Browser, confirm that the primary address loads and browser requests expose no private hostnames or loopback redirects.

For stronger staff isolation, create a second, unpublished v3 onion service pointing to the same local Nginx listener and protect it with Tor client authorization. Set its origin in `STAFF_ONION_URL` and include its hostname in `SERVER_ACTION_ALLOWED_ORIGINS`. Once configured, administrator and moderator routes return 404 on the public onion and remain available only through the authorized staff onion. Keep each operator's private authorization key off the servers and remove the matching `.auth` file when access is revoked.

The service-side authorization files belong in the staff hidden service's `authorized_clients` directory and use the `descriptor:x25519:<public-key>` format. Follow the [current Tor Project client-authorization procedure](https://community.torproject.org/onion-services/advanced/client-auth/) when generating and installing the key pair; do not improvise key encoding.

If `STAFF_ONION_URL` is not configured for the initial launch, staff routes remain on the primary onion behind application authentication. Record this as a temporary launch risk and schedule the private staff onion before expanding the team.

### 10. Initialize the administrator

Open `http://PRIMARY_V3_ADDRESS.onion/<ADMIN_URL_SECRET>/boot` through Tor and create the first administrator according to [ADMIN_INIT.md](ADMIN_INIT.md). Register the administrator's public PGP key, sign in, and complete MSID, PIN, and PGP verification.

Immediately after bootstrap:

1. Remove `SETUP_KEY` from `/etc/market/app.env`.
2. Restart the active application service.
3. Confirm that the bootstrap route rejects another administrator creation.
4. Store the administrator's private PGP key outside the server.

Create moderators through the administrator panel only when required. Moderators use `/moderator` and never use the secret administrator panel.

### 11. Install financial synchronization

Place a validated application copy in `/srv/market/financial` on the financial server, or adapt the unit working directory to the selected release. Create `/etc/market/financial.env` with database access, wallet RPC credentials, and `WALLET_SYNC_SECRET`. Copy the wallet synchronization service and timer from `deploy/` into `/etc/systemd/system/`.

Run one manual synchronization while observing sanitized logs, then enable the timer:

```sh
sudo systemctl start market-wallet-sync.service
sudo systemctl status market-wallet-sync.service
sudo systemctl enable --now market-wallet-sync.timer
sudo systemctl list-timers market-wallet-sync.timer
```

Only one scheduler may be active. The database advisory lock prevents overlap but does not replace clear operational ownership and monitoring.

Install `deploy/market-security-cleanup.service` and `.timer` on the same controlled worker. It removes expired challenges, stale rate buckets and old revoked sessions daily. Internal sanitized security events are retained for 90 days; forward them to the separate append-only log destination before local retention expires.

### 12. Run production checks

With the final production environment loaded on the application server, run:

```sh
npm run prod:check
npm run wallet:reconcile
```

The first command must confirm the database, wallet RPC, and global commission. Reconciliation is read-only and must show no unexplained cash or liability difference. Never alter balances to conceal a discrepancy.

Check each endpoint from its correct network location:

| Endpoint | Expected use |
| --- | --- |
| `/api/live` | Process availability without wallet dependency |
| `/api/health` | Minimal application readiness response |
| `/api/health/wallet` | Private financial check with `Authorization: Bearer <WALLET_SYNC_SECRET>` |

Never expose wallet-health credentials in URLs or public monitoring systems.

### 13. Acceptance checklist

Before enabling deposits or purchases, verify through the primary onion address:

- Registration, login, anti-phishing phrase, mandatory PGP 2FA, and logout.
- Administrator verification and moderator isolation.
- Buyer and vendor navigation on desktop and mobile devices.
- PGP-encrypted support conversations.
- Product creation, direct-URL protection, and moderation.
- Order reservation, validated shipping price, escrow, and disputes.
- Deposit-address creation and confirmed stagenet credit.
- Withdrawal approval, receipt persistence, and uncertain-transfer recovery.
- An empty mirror list showing only the primary onion address.
- Database backup, restoration into another database, and external copy.
- Blue/green application rollback.
- Alerts for application, database, wallet RPC, disk space, timer failures, and backup age.

Record the release SHA, migration names, onion hostname, test evidence, and responsible operator. Do not include secrets or private-message content in that record.

### 14. Launch and rollback

Start with financial functions disabled or tightly limited until final stagenet evidence and opening-balance reconciliation are approved. Enable normal traffic only after completing the acceptance checklist.

If an application release fails, point Nginx back to the prior healthy local release and reload it. Do not revert code to a version incompatible with an applied migration; follow the migration-specific recovery plan. If a database or wallet result is uncertain, suspend new financial operations and investigate. Never resend a withdrawal merely because an RPC call timed out.

After launch, review service health, wallet synchronization, queued withdrawals, database connections, disk space, and backups daily until a stable baseline exists. Add a public mirror later as a separate project: provision another failure domain, distribute the same build and secrets, test independently, and only then populate `PUBLIC_ONION_MIRRORS` and expand `SERVER_ACTION_ALLOWED_ORIGINS`.
