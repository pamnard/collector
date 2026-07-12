import { MIGRATION_001 } from "./migrations/001_initial.js";

export const CURRENT_SCHEMA_VERSION = 1;

export function getInitialMigration(): string {
  return MIGRATION_001;
}

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

export async function applyInitialMigration(db: SqlExecutor): Promise<void> {
  for (const statement of splitSqlMigration(getInitialMigration())) {
    await db.execute(statement);
  }
}
