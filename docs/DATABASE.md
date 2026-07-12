# SQLite index migrations

The search index lives in `collector.db` under the app data directory. Schema changes are applied incrementally at startup via `runMigrations()` (`@collector/db`).

## How it works

1. `schema_migrations` table records applied versions.
2. `MIGRATIONS` in `packages/db/src/migrate.ts` lists SQL scripts in order (001, 002, …).
3. On launch, only **pending** migrations run; existing vault files on disk are untouched.

## Adding migration 003+

1. Add `packages/db/src/migrations/00N_description.ts`.
2. Append `{ version: N, sql: MIGRATION_00N }` to `MIGRATIONS`.
3. Add a test in `packages/db/src/migrate.test.ts`.
4. Ship in the next app release — users must not delete `collector.db` manually.

## Verify locally

```bash
npm run test --workspace @collector/db
scripts/verify-deb-packaging.sh path/to/Collector_*.deb
```
