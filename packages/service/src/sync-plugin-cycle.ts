/**
 * One-plugin sync cycle (#28): authenticate → pull → create → mark → attach → ack → nextCursor.
 * markImported runs immediately after vault create (API contract), before attach.
 */

import type {
  BinaryPayload,
  NormalizedSyncItem,
  SyncCursor,
  SyncPlugin,
} from "@collector/api";
import type { SyncPluginImportResult } from "./sync-plugin-handoff.js";

export interface SyncPluginCycleHandoff {
  createFromNormalized(
    item: NormalizedSyncItem,
  ): Promise<SyncPluginImportResult>;
  attachMedia(itemId: string, media?: BinaryPayload[]): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
}

export interface RunSyncPluginCycleInput {
  plugin: SyncPlugin;
  cursor: SyncCursor | null;
  handoff: SyncPluginCycleHandoff;
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
  const { plugin, cursor, handoff } = input;

  if (plugin.authenticate) {
    await plugin.authenticate();
  }

  const pulled = await plugin.pull(cursor);
  const importedRemoteIds: string[] = [];
  const itemIds: string[] = [];

  for (const item of pulled.items) {
    let created: SyncPluginImportResult | null = null;
    let marked = false;
    try {
      created = await handoff.createFromNormalized(item);

      if (plugin.markImported) {
        await plugin.markImported([created.remoteId]);
        marked = true;
      }

      await handoff.attachMedia(created.itemId, item.media);

      importedRemoteIds.push(created.remoteId);
      itemIds.push(created.itemId);

      if (!plugin.markImported && plugin.ack) {
        await plugin.ack([created.remoteId]);
      }
    } catch (error) {
      if (created) {
        await handoff.deleteItem(created.itemId);
        if (marked && plugin.clearImported) {
          await plugin.clearImported([created.remoteId]);
        }
      }
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
