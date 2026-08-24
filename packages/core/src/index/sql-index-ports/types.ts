import type { Tag } from "@collector/shared";
import type { SqlExecutor, SqlReader } from "@collector/db";

export type TagWithCount = Tag & { item_count: number };

export type SqlIndexDb = SqlExecutor & SqlReader;

export interface SqlSelectRow {
  id: string;
}

export interface SqlSelector {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
}

export type SqlIndexStoreDb = SqlSelector & SqlExecutor;
