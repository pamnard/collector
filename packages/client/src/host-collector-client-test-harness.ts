import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, vi } from "vitest";
import { NodeSqliteExecutor } from "@collector/service/host";
import type { VaultIndexSyncStatus } from "@collector/api";
import type { CollectorHostServiceClient } from "./host-collector-client.js";

/** Legacy incomplete schema — migrate leaves it unhealthy until rebuild. */
export async function writeLegacyBrokenIndexDb(dbPath: string): Promise<void> {
  const db = await NodeSqliteExecutor.open(dbPath);
  await db.execute(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  await db.execute(
    "INSERT INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'))",
  );
  await db.execute(`CREATE TABLE items (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    title TEXT NOT NULL
  )`);
  await db.execute(`CREATE VIRTUAL TABLE items_fts USING fts5(
    item_id UNINDEXED,
    title,
    description,
    content,
    tokenize = 'unicode61'
  )`);
  await db.execute(`CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    created_at TEXT NOT NULL
  )`);
  await db.execute(`CREATE TABLE item_tags (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id)
  )`);
  await db.close();
}

export async function waitForItemIndexed(
  client: CollectorHostServiceClient,
  itemId: string,
): Promise<void> {
  await vi.waitFor(async () => {
    const result = await client.items.queryIndex("all", undefined, {
      limit: 100,
      offset: 0,
    });
    expect(result.ids).toContain(itemId);
  });
}

export async function waitForVaultIndexSyncDone(
  client: CollectorHostServiceClient,
  timeoutMs = 5_000,
): Promise<VaultIndexSyncStatus> {
  if (client.index.getVaultIndexSyncStatus().status === "done") {
    return client.index.getVaultIndexSyncStatus();
  }
  return new Promise<VaultIndexSyncStatus>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(
        new Error(
          `vault index sync did not reach done within ${timeoutMs}ms (status=${client.index.getVaultIndexSyncStatus().status})`,
        ),
      );
    }, timeoutMs);
    const sub = client.index.subscribeVaultIndexSyncStatus((status) => {
      if (status.status === "done") {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(status);
      }
    });
  });
}

export function useTempDataDirs(): {
  mktemp: (prefix: string) => string;
} {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return {
    mktemp(prefix: string): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
  };
}
