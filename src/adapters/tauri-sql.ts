import Database from "@tauri-apps/plugin-sql";
import type { SqlExecutor } from "@collector/db";
import type { SqlSelector } from "@collector/core";

export class TauriSqlAdapter implements SqlExecutor, SqlSelector {
  constructor(private readonly db: Database) {}

  static async open(filename = "collector.db"): Promise<TauriSqlAdapter> {
    const db = await Database.load(`sqlite:${filename}`);
    return new TauriSqlAdapter(db);
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const result = await this.db.execute(query, bindValues);
    return result.rowsAffected;
  }

  async select<TRow>(query: string, bindValues: unknown[] = []): Promise<TRow[]> {
    return this.db.select<TRow[]>(query, bindValues);
  }
}
