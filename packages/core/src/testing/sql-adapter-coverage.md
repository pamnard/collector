# MemorySql vs BetterSqlite test coverage

Issue #887. Many vault/index suites are *real* against `MemorySqlAdapter`, but FTS
binds, JOINs, and SQLite-specific SQL still only fail on production BetterSqlite.

## Rule of thumb

| Adapter | Use when | Do **not** use when |
|---------|----------|---------------------|
| **MemorySqlAdapter** | Unit-speed FS/vault/service orchestration; index write/read that MemorySql implements as Map ops | Asserting FTS `MATCH`, `ORDER BY rank`, `COLLATE`, multi-table JOINs, or bind-order seams |
| **BetterSqlite** (`createSqlIndexTestSuite` / `BetterSqliteMigrator` + temp `collector.db`) | Any test that asserts SQL semantics that production SQLite must honor | Pure orchestration where SQL shape is irrelevant |

Shared harness: [`../index/sql-index-test-harness.ts`](../index/sql-index-test-harness.ts)
(`createSqlIndexTestSuite` → migrated BetterSqlite temp index + vault).

## Must hit BetterSqlite (SQL / FTS / JOIN seams)

These suites open a real temp index (or equivalent migrate probe). Keep new FTS/JOIN
assertions here — do not add MemorySql-only cases for the same seams.

| Suite | Critical seams covered |
|-------|------------------------|
| `index/sql-index-sync.test.ts` | Phased metadata/content FTS upserts, frontmatter-only FTS tokens, batch relation binds |
| `index/sql-index-queries.test.ts` | Nav filters, sort/`COLLATE`, FTS pagination, folder-exact FTS, **FTS + `item_tags` JOIN**, adjacent items |
| `index/sql-index-queries-by-ids.test.ts` | Multi-id selects + tag/collection relation JOINs |
| `index/sql-index-rewrite.test.ts` | PK rewrite preserving tags/media/FTS; `listItemIdsByTag` |
| `edges/sql-item-edges.test.ts` | Edge rebuild + FTS body catalog JOINs |
| `vault/tag-operations.test.ts` | `listTagsWithCounts` aggregate JOINs |
| `vault/sync-operations.test.ts` (phased FTS case) | Sync metadata-before-content FTS visibility on disk index |
| `service/items-search.test.ts` | Service search/dashboard over real FTS |
| `service/items-user-edges.test.ts` | User edges over BetterSqlite |
| `db/migrate.test.ts`, `db/reset.test.ts`, `service/index-boot.test.ts` | Schema/migrate probes on `collector.db` |

## Stay on MemorySql (unit-speed)

Orchestration, FS layout, jobs enqueue, and CRUD flows where the index is a stand-in.
They may exercise MemorySql's partial SQL surface, but they are **not** the production
SQLite contract. Prefer BetterSqlite probes above when adding FTS/JOIN assertions.

Examples (non-exhaustive):

- Most `vault/*-operations.test.ts`, `vault/vault-fs-batch.test.ts`, `vault/scan.test.ts`
- `vault/item-index-*.test.ts`, `vault/folder-prefix-index-sync.test.ts` (sync orchestration)
- `vault/sync-operations.test.ts` cases that do not open BetterSqlite
- `service/items-crud-*.test.ts`, `service/sync-plugin-*.test.ts`, `service/media-cover.test.ts`
- `service/drop-import.integration.test.ts`, `jobs/handlers/item-extract-auto.test.ts`

## Adding coverage

1. Prefer extending an existing BetterSqlite suite via `createSqlIndexTestSuite`.
2. Cover the failure mode once (bind order, JOIN filter, FTS rank/MATCH) — do not mirror
   every MemorySql case onto BetterSqlite.
3. Synthetic vault/item/tag ids only; never real user paths or vault ids.
