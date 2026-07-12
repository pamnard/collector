import Database from "better-sqlite3";
import type { SqlMigrator } from "../migrate.js";

export class BetterSqliteMigrator implements SqlMigrator {
  constructor(private readonly db: Database.Database) {}

  static open(path: string): BetterSqliteMigrator {
    const db = new Database(path);
    db.pragma("foreign_keys = ON");
    return new BetterSqliteMigrator(db);
  }

  close(): void {
    this.db.close();
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const result = this.db.prepare(query).run(...bindValues);
    return result.changes;
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    return this.db.prepare(query).all(...bindValues) as T[];
  }
}
