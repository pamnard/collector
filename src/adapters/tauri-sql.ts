import Database from "@tauri-apps/plugin-sql";
import type { SqlExecutor } from "@collector/db";
import type { SqlSelector } from "@collector/core";
import { INDEX_DB_URI } from "../services/index-db-path";

export class TauriSqlAdapter implements SqlExecutor, SqlSelector {
  constructor(private readonly db: Database) {}

  static async open(): Promise<TauriSqlAdapter> {
    const db = await Database.load(INDEX_DB_URI);
    const adapter = new TauriSqlAdapter(db);
    await adapter.execute("PRAGMA busy_timeout = 5000");
    return adapter;
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const result = await this.db.execute(query, bindValues);
    return result.rowsAffected;
  }

  async select<TRow>(query: string, bindValues: unknown[] = []): Promise<TRow[]> {
    return this.db.select<TRow[]>(query, bindValues);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
