/**
 * Sync plugin registry / loader (#29).
 *
 * Build-time catalog + opaque cursor state under
 * `{dataDir}/sync-plugins/{vaultId}.json`. Host run entrypoint only —
 * not common sync settings.
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  SyncCursor,
  SyncNowResult,
  SyncPlugin,
  SyncPluginsPort,
} from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { createSyncPluginHandoff } from "./sync-plugin-handoff.js";
import { runSyncPluginCycle } from "./sync-plugin-cycle.js";

export const SYNC_PLUGIN_STATE_DIR = "sync-plugins";
export const MOCK_SYNC_PLUGIN_ID = "mock";

interface VaultSyncPluginStateFile {
  schema_version: 1;
  cursors: Record<string, SyncCursor | null>;
}

export interface SyncPluginRegistryDeps {
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  deleteItem: (itemId: string) => Promise<void>;
  /**
   * Build-time catalog. Default empty — mock is tests-only via override.
   */
  createCatalog?: () => SyncPlugin[];
}

export function createSyncPluginRegistry(
  deps: SyncPluginRegistryDeps,
): SyncPluginsPort {
  const catalog = deps.createCatalog?.() ?? [];
  const byId = new Map(catalog.map((plugin) => [plugin.id, plugin]));
  const handoff = createSyncPluginHandoff({
    createItem: deps.createItem,
    attachMediaFiles: deps.attachMediaFiles,
    deleteItem: deps.deleteItem,
  });

  const statePathFor = (vaultId: string): string =>
    deps.fs.join(deps.dataDir, SYNC_PLUGIN_STATE_DIR, `${vaultId}.json`);

  const loadState = async (
    vaultId: string,
  ): Promise<VaultSyncPluginStateFile> => {
    const path = statePathFor(vaultId);
    if (!(await deps.fs.exists(path))) {
      return { schema_version: 1, cursors: {} };
    }
    const raw = JSON.parse(
      await deps.fs.readText(path),
    ) as VaultSyncPluginStateFile;
    if (
      raw.schema_version !== 1 ||
      typeof raw.cursors !== "object" ||
      !raw.cursors
    ) {
      throw new Error(
        `sync-plugins state corrupt at ${path}: expected schema_version 1 with cursors`,
      );
    }
    return raw;
  };

  const saveState = async (
    vaultId: string,
    state: VaultSyncPluginStateFile,
  ): Promise<void> => {
    const dir = deps.fs.join(deps.dataDir, SYNC_PLUGIN_STATE_DIR);
    await deps.fs.mkdir(dir);
    await deps.fs.writeText(
      statePathFor(vaultId),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  };

  /** One in-flight leader loop per plugin; concurrent callers coalesce. */
  const leaders = new Map<string, Promise<SyncNowResult>>();
  const rerunRequested = new Map<string, boolean>();

  const runOnce = async (pluginId: string): Promise<SyncNowResult> => {
    const plugin = byId.get(pluginId);
    if (!plugin) {
      throw new Error(`Unknown sync plugin: ${pluginId}`);
    }

    const vaultId = await deps.resolveActiveVaultId();
    const state = await loadState(vaultId);
    const cursor = state.cursors[pluginId] ?? null;

    const result = await runSyncPluginCycle({
      plugin,
      cursor,
      handoff,
    });

    state.cursors[pluginId] = result.nextCursor;
    await saveState(vaultId, state);

    if (plugin.clearImported && result.importedRemoteIds.length > 0) {
      await plugin.clearImported(result.importedRemoteIds);
    }

    return {
      importedCount: result.itemIds.length,
      itemIds: result.itemIds,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
  };

  return {
    async syncNow(pluginId: string): Promise<SyncNowResult> {
      const existing = leaders.get(pluginId);
      if (existing) {
        rerunRequested.set(pluginId, true);
        return existing;
      }

      const loop = (async (): Promise<SyncNowResult> => {
        let last!: SyncNowResult;
        for (;;) {
          rerunRequested.set(pluginId, false);
          last = await runOnce(pluginId);
          if (!rerunRequested.get(pluginId)) {
            break;
          }
        }
        return last;
      })();

      leaders.set(pluginId, loop);
      try {
        return await loop;
      } finally {
        if (leaders.get(pluginId) === loop) {
          leaders.delete(pluginId);
          rerunRequested.delete(pluginId);
        }
      }
    },
  };
}
