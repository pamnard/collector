/**
 * Empty-but-valid SQLite index + synthetic large vault → full reindex succeeds
 * without dual UI disk-stream (core sync path only).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../packages/db/dist/migrate.js";
import { BetterSqliteMigrator } from "../packages/db/dist/testing/better-sqlite.js";
import { NodeFileSystemAdapter } from "../packages/core/dist/adapters/node-fs.js";
import { SqlVaultIndexStore } from "../packages/core/dist/index/sql-index.js";
import {
  createVault,
  upsertItem,
  syncIndexFromFilesystem,
} from "../packages/core/dist/vault/operations.js";
import { createId } from "../packages/core/dist/util/ids.js";

const ITEM_COUNT = 320;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "collector-large-empty-index-"));
const fs = new NodeFileSystemAdapter();

try {
  const noopIndex = {
    upsertVault: async () => {},
    deleteVault: async () => {},
    upsertItem: async () => {},
    upsertItemMetadata: async () => {},
    upsertItemContent: async () => {},
    deleteItem: async () => {},
    upsertMedia: async () => {},
    deleteMedia: async () => {},
    deleteMediaForItem: async () => {},
    upsertTag: async () => {},
    deleteTag: async () => {},
    listTagsWithCounts: async () => [],
    listItemIdsByTag: async () => [],
    listItemIdsByFolderPrefix: async () => [],
    listItemIdsByNavFilter: async () => [],
    listFolderItemCounts: async () => [],
    listVaultItemIds: async () => [],
    listItemFilesByIds: async () => [],
    listVaultItemSyncMeta: async () => [],
    patchItemSyncMeta: async () => {},
    getReconcileFingerprint: async () => null,
    setReconcileFingerprint: async () => {},
    searchItemIds: async () => [],
  };

  const diskCtx = { fs, index: noopIndex };
  const { meta, path } = await createVault(diskCtx, dir, {
    name: "Large Vault",
    isDefault: true,
  });

  for (let i = 0; i < ITEM_COUNT; i += 1) {
    await upsertItem(diskCtx, path, meta.id, {
      item: {
        id: createId(),
        vault_id: meta.id,
        title: `Item ${i}`,
        description: "",
        content_type: "note",
        source_type: "manual",
        metadata: {},
        is_archived: false,
        is_favorite: false,
        tag_ids: [],
        collection_ids: [],
        folder_path: i % 10 === 0 ? "Bench" : "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      content: `content ${i}`,
    });
  }

  const dbPath = join(dir, "collector.db");
  const db = BetterSqliteMigrator.open(dbPath);
  await runMigrations(db);
  const index = new SqlVaultIndexStore(db);
  await index.upsertVault(meta, path);

  const idsBefore = await index.listVaultItemIds(meta.id);
  if (idsBefore.length !== 0) {
    fail(`expected empty index, got ${idsBefore.length} rows`);
  }

  const batches = [];
  let metadataComplete = null;
  const started = Date.now();
  const report = await syncIndexFromFilesystem({ fs, index }, path, meta.id, {
    onBatch: (progress) => {
      batches.push(progress.processed);
    },
    onMetadataComplete: (progress) => {
      metadataComplete = {
        indexed: progress.indexed,
        contentIndexed: progress.contentIndexed,
        phase: progress.phase,
      };
    },
  });
  const elapsedMs = Date.now() - started;

  if (!metadataComplete) {
    fail("expected onMetadataComplete before sync resolve");
  }
  if (metadataComplete.indexed !== ITEM_COUNT) {
    fail(
      `expected metadataComplete.indexed=${ITEM_COUNT}, got ${metadataComplete.indexed}`,
    );
  }
  if (metadataComplete.contentIndexed !== 0) {
    fail(
      `expected metadataComplete.contentIndexed=0, got ${metadataComplete.contentIndexed}`,
    );
  }
  if (metadataComplete.phase !== "metadata") {
    fail(`expected metadataComplete.phase=metadata, got ${metadataComplete.phase}`);
  }
  if (report.indexed !== ITEM_COUNT) {
    fail(`expected indexed=${ITEM_COUNT}, got ${report.indexed}`);
  }
  if (report.contentIndexed !== ITEM_COUNT) {
    fail(`expected contentIndexed=${ITEM_COUNT}, got ${report.contentIndexed}`);
  }
  if (report.errors.length > 0) {
    fail(`unexpected sync errors: ${report.errors[0]?.message}`);
  }
  if (batches.length < 2) {
    fail(`expected multiple onBatch callbacks, got ${batches.length}`);
  }

  const idsAfter = await index.listVaultItemIds(meta.id);
  if (idsAfter.length !== ITEM_COUNT) {
    fail(`expected ${ITEM_COUNT} indexed ids, got ${idsAfter.length}`);
  }

  const folderCounts = await index.listFolderItemCounts(meta.id);
  const bench = folderCounts.find((row) => row.folder_path === "Bench");
  if (!bench || bench.item_count < 1) {
    fail("expected Bench folder counts after reindex");
  }

  db.close();
  console.log(
    `OK: large empty-index sync indexed=${ITEM_COUNT} batches=${batches.length} elapsedMs=${elapsedMs}`,
  );
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
