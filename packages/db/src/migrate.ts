import { MIGRATION_001 } from "./migrations/001_initial.js";

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [{ version: 1, sql: MIGRATION_001 }];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function splitSqlMigration(sql: string): string[] {
  const withoutLineComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  return withoutLineComments
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface SqlExecutor {
  execute(query: string, bindValues?: unknown[]): Promise<number>;
}

export interface SqlReader {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export type SqlMigrator = SqlExecutor & SqlReader;

async function readAppliedVersions(db: SqlReader): Promise<Set<number>> {
  try {
    const rows = await db.select<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    return new Set(rows.map((row) => row.version));
  } catch {
    return new Set();
  }
}

async function recordMigration(db: SqlExecutor, version: number): Promise<void> {
  await db.execute(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))",
    [version],
  );
}

export async function runMigrations(db: SqlMigrator): Promise<number[]> {
  const applied = await readAppliedVersions(db);
  const newlyApplied: number[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }

    for (const statement of splitSqlMigration(migration.sql)) {
      await db.execute(statement);
    }

    await recordMigration(db, migration.version);
    newlyApplied.push(migration.version);
  }

  return newlyApplied;
}

export function getInitialMigration(): string {
  return MIGRATION_001;
}
