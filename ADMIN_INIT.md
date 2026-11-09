# Administrator and moderator setup

## First administrator

The first administrator is created at `/<ADMIN_URL_SECRET>/boot`, implemented in `src/app/staff-vault/boot/page.tsx`.

1. Configure `DATABASE_URL`, `SESSION_SECRET`, `AUTH_SALT`, `SETUP_KEY`, `ADMIN_URL_SECRET` and `ADMIN_MSID`.
2. Apply migrations and start the application.
3. Complete the home page entry verification, then open bootstrap.
4. Provide `SETUP_KEY`, username, strong password, six-digit PIN and MSID.
5. Sign in, register your PGP public key in your profile and verify at `/<ADMIN_URL_SECRET>/verify`.

The administrator and platform wallet are created in one transaction. A PostgreSQL lock serializes attempts; bootstrap refuses creation once an administrator exists. Verification requires MSID, PIN and PGP, including in development. Authenticated operations check account status and role in the database.

## Moderators

An administrator creates or assigns accounts with database role `STAFF`, shown as Moderator in role selectors. Preserve this value for existing-account compatibility. Assign `products` for listing moderation, `orders` for disputed-order review and `support` for support handling and dispute settlement.

Moderators register their own PGP public key and use `/moderator/verify` with their PIN and signed challenge. They do not need the administrator master ID. Their workspace is `/moderator`. Permissions are enforced server-side, not only in navigation. Legacy administrative permissions such as `wallets`, `system` and `users` no longer grant STAFF accounts administrative access.

PIN/PGP changes revoke previous sessions. Do not share private keys or administrator credentials. Do not promote accounts through improvised SQL or run demonstration seeds on real databases; seeds have known credentials and synthetic balances.
