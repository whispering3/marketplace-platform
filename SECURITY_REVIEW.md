# Security Review

Review date: 2026-09-14

## Scope

This review covered authentication, PGP 2FA, sessions, staff authorization, object ownership, direct URL access, API routes, Server Actions, CSRF and origin validation, Host header handling, redirects, wallet RPC access, order and escrow transitions, user-controlled content, security headers, dependency advisories, and secret tracking.

## Remediated findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Pending or paused listings could be requested directly by product ID. | Product pages now return 404 unless the listing is public or the requester is its owner/admin. Search, recommendations, and vendor storefronts require approved listings. |
| High | A browser could omit a configured paid shipping option and receive the default zero shipping cost. | Checkout now requires a shipping option belonging to the selected physical product whenever options exist. |
| High | Order lifecycle maintenance was exported from a `use server` module without an authentication boundary. | Lifecycle code moved to a `server-only` module and is no longer published as a Server Action. |
| High | A moderator with user-management permission could target another staff account for banning. | Moderators cannot ban staff/admin accounts, and no staff account can ban itself. Self-demotion is also blocked. |
| Medium | API routes were outside the common proxy checks. | The proxy matcher now covers APIs and enforces accepted hosts plus security headers. |
| Medium | Several form POST routes relied on cookie policy without explicit origin and body-size checks. | Sentinel, order-support, announcement, logout, and authentication mutations now enforce same-origin requests and bounded bodies. |
| Medium | Logout, Sentinel initialization, and wallet synchronization accepted GET mutations. | These operations now use POST only; GET returns 405. |
| Medium | The public health response exposed deployment and database metadata. | Public health now returns only `{ "ok": true }` or `{ "ok": false }`. Wallet health remains secret-protected. |
| Medium | Product images accepted arbitrary URLs/data and potentially excessive payloads. | New images are restricted to local paths or validated PNG/JPEG data URLs, with decoded-size limits and metadata removal. |
| Medium | Encrypted messages and bulk inventory had no consistent maximum size. | PGP blocks, ticket subjects, listing fields, images, and bulk inventory now have explicit limits. |
| Low | Selected sensitive string checks used normal equality. | Setup key, admin identity ID, and PGP login token checks now use constant-time comparison. |
| Low | Some internal errors were reflected in redirect query strings. | Public error codes are allowlisted and encoded. |
| Low | Mirror entries accepted arbitrary URL formats. | Public mirrors are restricted to clean HTTP `.onion` origins without credentials, ports, paths, queries, or fragments. |
| High | One-time authentication proofs were carried in browser URLs. | Password, PGP enrollment and anti-phishing phrase proofs now remain in encrypted, short-lived, HttpOnly flow cookies. |
| High | Session, Sentinel and gateway tokens reused one root key without domain separation. | Each token family now derives a purpose-specific key and validates its issuer and audience. |
| Medium | Staff sessions were stateless and remained valid for up to two hours after staff verification. | Sessions now have server-side records, per-device revocation, database expiry checks and a 30-minute privileged lifetime. |
| Medium | Gateway attempt state could be reset by deleting the CAPTCHA cookie. | Persistent per-gateway and global rate buckets now protect challenge creation and verification; Nginx also has global request and connection ceilings. |
| Medium | Authentication security events were not stored separately from administrative changes. | Sanitized security events now record outcomes without IP addresses, credentials, tokens or PGP content. |

## Controls verified

- Session JWTs accept HS256 only and are checked against the current database role, ban state, and session version.
- Session, Sentinel, and gateway cookies use `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Login requires password proof followed by mandatory PGP decryption; authentication challenges expire and cannot be replayed.
- Admin and moderator pages have separate role gates. Staff permissions are re-read from the database for sensitive actions.
- Conversations, tickets, notifications, orders, products, favorites, wallet records, and whitelist mutations enforce ownership or an explicit staff permission.
- Wallet synchronization and wallet RPC health require a secret compared in constant time.
- Monetary changes use transactions, row locks, exact decimal values, state transitions, and idempotent records where required.
- CSP blocks scripts, frames, objects, workers, external connections, and external images. Forms are limited to the current origin.
- No `.env` file or local credential artifact is tracked by Git.
- The production dependency audit reported zero known vulnerabilities.

## Validation evidence

- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm run build`
- `npm test`: 9 production tests and authenticated RPC tests passed
- `npm run test:integration`: authentication, challenge replay/expiry, money, escrow, concurrency, withdrawal, reconciliation, and reservation tests passed
- `npm run test:browser`: forged Host rejection, CSRF rejection, method restrictions, non-disclosing health response, listing and ticket IDOR checks, mandatory PGP login, staff verification, permission revocation, and session revocation passed
- `npm run local:test:verify`: buyer, vendor, moderator, and admin completed the real local authentication flow

## Required before production

`npm run prod:check` remains blocked until real values are configured for:

- `ADMIN_XMR_ADDRESS`
- `XMR_RPC_URL`
- `XMR_RPC_USER`
- `XMR_RPC_PASS`
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
- `DEPLOYMENT_ID`

Keep wallet RPC bound to a private interface, restrict it with the host firewall, and never expose the RPC port through Nginx or Tor. Run the full validation suite again after adding production secrets and before sending real funds.
