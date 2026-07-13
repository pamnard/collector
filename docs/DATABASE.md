# SQLite search index

`collector.db` is a **disposable search index**. Vault files on disk are the source of truth.

## Schema

- One migration: `001_initial.ts` defines the full current schema.
- No incremental column patches — if the index DB is wrong, delete and rebuild from vault files.

## Startup

`collector.db` lives at `{appConfigDir}/collector.db` (Tauri SQL plugin requirement). Vault files live under `{appDataDir}/collector/`. On startup, junk copies under `{appDataDir}/collector.db` or `{appDataDir}/collector/collector.db` are removed.

1. `runMigrations()` creates any missing tables/indexes.
2. `ensureHealthyIndex()` validates required tables/columns and runs the same SQL probes the UI uses (nav filters, tags join, FTS).
3. If validation fails → delete `collector.db` (+ `-wal`/`-shm`), recreate schema, re-sync vaults from disk via `syncVaultIndexFromFilesystem()` (vault row → tags → items).

## When the schema changes

Edit `001_initial.ts` in place while the app has no production users with irreplaceable index-only data. Existing dev DBs self-heal via startup rebuild.

## Verify locally

```bash
npm run test --workspace @collector/db
npm run build:packages && npm run typecheck
npm run tauri:dev   # open app — startup must not error
```
