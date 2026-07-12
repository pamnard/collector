# Vault and item.json schema

Vault files (`vault.meta.json`, `items/*/item.json`) are the **source of truth**. `SCHEMA_VERSION` in `@collector/shared` is the current on-disk format version.

## Policy

- Bumping `SCHEMA_VERSION` **requires** a forward migration in `packages/core/src/vault/schema-migrate.ts` (or a backward-compatible reader).
- Never ship a release that reads old vaults but writes incompatible files without migration.
- SQLite index schema is separate — see [DATABASE.md](./DATABASE.md).

## Current version: 2

| Version | Vault changes | Item changes |
|---------|---------------|--------------|
| 1 | Initial format | `item.json` without `content_revision` |
| 2 | `settings: {}` on vault meta | `content_revision`, explicit `tag_ids` / `collection_ids` |

`migrateVaultSchema()` runs when a vault is opened. It upgrades meta and every item in place, then re-indexes on next sync.

## Adding version 3+

1. Bump `SCHEMA_VERSION` in `packages/shared/src/constants.ts`.
2. Extend zod schemas in `packages/shared/src/schemas.ts`.
3. Add `migrate*V2ToV3` (etc.) in `schema-migrate.ts`.
4. Add fixture test in `packages/core/src/vault/schema-migrate.test.ts`.
5. Document the change in this file.

## Sample fixture

See `schema-migrate.test.ts` — v1 vault without `settings` and v1 item without `content_revision` round-trips to v2 without losing title or content.
