# Contributing to Market

Thank you for helping improve Market.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md).
- Do not open a public issue for a suspected vulnerability or expose a credential, private key, wallet data, onion address, user data or production configuration.
- Discuss substantial changes in an issue before investing significant implementation time.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install the locked dependencies with `npm ci`.
3. Copy `.env.template` to `.env` and use only disposable, local infrastructure.
4. Run `npx prisma generate`, then apply migrations to a local database.
5. Keep a pull request small and explain the motivation, approach and validation performed.

Before opening a pull request, run:

```sh
npx prisma validate
npm run typecheck
npm run lint
npm test
npm run build
```

Run integration, browser and wallet-related checks only against disposable local services. Never use a production database, wallet or credentials in tests.

## Pull requests

- Use clear, imperative commit messages.
- Add or update tests when behavior changes.
- Update documentation and the changelog for user-visible changes.
- Do not include generated folders, `.env` files, local databases, backups or secrets.
- By contributing, you agree that your contribution is licensed under the repository's Apache-2.0 license.
