import type {
  ItemSyncMetaPatch,
  ReconcileFingerprint,
} from "../../adapters/types.js";
import { INDEX_SYNC_WRITE_BATCH } from "../../util/concurrency.js";
import { serializeReconcileFingerprint } from "../../vault/reconcile-fingerprint.js";
import { sqlInPlaceholders } from "../sql-index-helpers.js";
import * as indexQueries from "../sql-index-queries.js";
import { requireSqlSelect } from "./require-select.js";
import type { SqlIndexDb, SqlIndexStoreDb } from "./types.js";

export function createSyncWritePort(db: SqlIndexDb) {
  return {
    async patchItemSyncMeta(
      itemId: string,
      meta: {
        fileMtimeMs: number;
        updatedAt: string;
        contentRevision: number;
        createdAt: string;
      },
    ): Promise<void> {
      await db.execute(
        `UPDATE items
         SET file_mtime_ms = ?, updated_at = ?, content_revision = ?, created_at = ?
         WHERE id = ?`,
        [
          meta.fileMtimeMs,
          meta.updatedAt,
          meta.contentRevision,
          meta.createdAt,
          itemId,
        ],
      );
    },

    async patchItemSyncMetaBatch(
      patches: Array<{ itemId: string } & ItemSyncMetaPatch>,
    ): Promise<void> {
      for (
        let offset = 0;
        offset < patches.length;
        offset += INDEX_SYNC_WRITE_BATCH
      ) {
        const chunk = patches.slice(offset, offset + INDEX_SYNC_WRITE_BATCH);
        const itemIds = chunk.map((patch) => patch.itemId);
        const caseBinds = (value: (patch: (typeof chunk)[number]) => unknown) =>
          chunk.flatMap((patch) => [patch.itemId, value(patch)]);
        await db.execute(
          `UPDATE items
           SET file_mtime_ms = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
               updated_at = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
               content_revision = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END,
               created_at = CASE id ${chunk.map(() => "WHEN ? THEN ?").join(" ")} END
           WHERE id IN (${sqlInPlaceholders(itemIds.length)})`,
          [
            ...caseBinds((patch) => patch.fileMtimeMs),
            ...caseBinds((patch) => patch.updatedAt),
            ...caseBinds((patch) => patch.contentRevision),
            ...caseBinds((patch) => patch.createdAt),
            ...itemIds,
          ],
        );
      }
    },

    async setReconcileFingerprint(
      vaultId: string,
      fingerprint: ReconcileFingerprint,
    ): Promise<void> {
      await db.execute(
        `UPDATE vaults SET reconcile_fingerprint_json = ? WHERE id = ?`,
        [serializeReconcileFingerprint(fingerprint), vaultId],
      );
    },
  };
}

export type SyncWritePort = ReturnType<typeof createSyncWritePort>;

export const syncSelectStubs = {
  getReconcileFingerprint(_vaultId: string): Promise<ReconcileFingerprint | null> {
    return requireSqlSelect("getReconcileFingerprint");
  },
  listVaultItemSyncMeta(_vaultId: string): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    return requireSqlSelect("listVaultItemSyncMeta");
  },
  listItemSyncMetaByIds(
    _vaultId: string,
    _itemIds: string[],
  ): Promise<
    Array<{
      id: string;
      file_mtime_ms: number | null;
      updated_at: string;
      content_revision: number;
      created_at: string;
    }>
  > {
    return requireSqlSelect("listItemSyncMetaByIds");
  },
};

export function createSyncStorePort(selector: SqlIndexStoreDb) {
  return {
    listVaultItemSyncMeta(vaultId: string) {
      return indexQueries.listVaultItemSyncMeta(selector, vaultId);
    },
    listItemSyncMetaByIds(vaultId: string, itemIds: string[]) {
      return indexQueries.listItemSyncMetaByIds(selector, vaultId, itemIds);
    },
    getReconcileFingerprint(vaultId: string) {
      return indexQueries.getReconcileFingerprint(selector, vaultId);
    },
  };
}

export type SyncStorePort = ReturnType<typeof createSyncStorePort>;
