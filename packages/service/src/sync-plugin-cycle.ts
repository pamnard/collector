/**
 * One-plugin sync cycle (#28): authenticate → pull → import → mark → ack → nextCursor.
 * Wake/schedule is per-plugin; this only runs after something decided to sync.
 */

import type {
  NormalizedSyncItem,
  SyncCursor,
  SyncPlugin,
} from "@collector/api";
import type { SyncPluginImportResult } from "./sync-plugin-handoff.js";

export interface RunSyncPluginCycleInput {
  plugin: SyncPlugin;
  cursor: SyncCursor | null;
  importItem: (item: NormalizedSyncItem) => Promise<SyncPluginImportResult>;
}

export interface RunSyncPluginCycleResult {
  importedRemoteIds: string[];
  itemIds: string[];
  /**
   * From pull when every item imported successfully; otherwise null so the
   * caller keeps the previous cursor.
   */
  nextCursor: SyncCursor | null;
  warnings: string[];
}

export async function runSyncPluginCycle(
  input: RunSyncPluginCycleInput,
): Promise<RunSyncPluginCycleResult> {
  const { plugin, cursor, importItem } = input;

  if (plugin.authenticate) {
    await plugin.authenticate();
  }

  const pulled = await plugin.pull(cursor);
  const importedRemoteIds: string[] = [];
  const itemIds: string[] = [];

  for (const item of pulled.items) {
    try {
      const imported = await importItem(item);
      importedRemoteIds.push(imported.remoteId);
      itemIds.push(imported.itemId);

      if (plugin.markImported) {
        // Durable per-item mark; ack is batched below to avoid N remote deletes / saves.
        await plugin.markImported([imported.remoteId]);
      } else if (plugin.ack) {
        await plugin.ack([imported.remoteId]);
      }
    } catch (error) {
      if (
        plugin.markImported &&
        plugin.ack &&
        importedRemoteIds.length > 0
      ) {
        await plugin.ack(importedRemoteIds);
      }
      throw error;
    }
  }

  if (plugin.markImported && plugin.ack && importedRemoteIds.length > 0) {
    await plugin.ack(importedRemoteIds);
  }

  return {
    importedRemoteIds,
    itemIds,
    nextCursor: pulled.nextCursor,
    warnings: pulled.warnings ?? [],
  };
}
