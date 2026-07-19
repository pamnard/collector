/**
 * Node better-sqlite3 adapter for out-of-band service host (#151).
 * Not used by the Tauri in-process path.
 */

import Database from "better-sqlite3";
import type { ClosableSqlExecutor } from "../index-boot.js";

export class NodeSqliteExecutor implements ClosableSqlExecutor {
  constructor(private readonly db: Database.Database) {}

  static open(path: string): NodeSqliteExecutor {
    const db = new Database(path);
    db.pragma("foreign_keys = ON");
    return new NodeSqliteExecutor(db);
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const result = this.db.prepare(query).run(...bindValues);
    return result.changes;
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    return this.db.prepare(query).all(...bindValues) as T[];
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
