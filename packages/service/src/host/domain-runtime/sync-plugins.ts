import type { SyncPluginsPort, TelegramSyncPort } from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import {
  DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  TELEGRAM_PLUGIN_ID,
  createTelegramSyncPlugin,
  createTelegramSyncService,
  loadTelegramPluginConfig,
  markTelegramLastSyncAt,
} from "../../plugins/telegram/index.js";
import type { createCredentialsService } from "../../credentials.js";
import type { createItemsSearchService } from "../../items-search.js";
import type { createMediaCoverService } from "../../media-cover.js";
import type { createTagsFoldersService } from "../../tags-folders.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import { createSyncPluginRegistry } from "../../sync-plugin-registry.js";
import {
  createSyncPluginWakeController,
  type SyncPluginWakeController,
  type SyncPluginWakePolicy,
} from "../../sync-plugin-wake.js";
import { reportEnqueueFailure } from "../../job-permanent-failure.js";
import type { createJobPermanentFailureStore } from "../../job-permanent-failure.js";
import {
  enqueueSyncPluginPull,
  takeSyncPluginPullResult,
} from "../../jobs/handlers/sync-plugin-pull.js";
import { enqueueAndAwaitResult } from "../../jobs/job-wait.js";
import { phaseBHandlerBindings } from "../../jobs/phase-b-bindings.js";
import { createSyncPluginPullHandler } from "../../jobs/handlers/sync-plugin-pull.js";

export interface SyncPluginRuntimeDeps {
  fs: FileSystemAdapter;
  dataDir: string;
  credentials: ReturnType<typeof createCredentialsService>;
  itemsSearch: ReturnType<typeof createItemsSearchService>;
  mediaCover: ReturnType<typeof createMediaCoverService>;
  tagsFolders: ReturnType<typeof createTagsFoldersService>;
  resolveActiveVaultId: () => Promise<string>;
  requireJobs: () => JobQueue;
  jobPermanentFailure: ReturnType<typeof createJobPermanentFailureStore>;
  wakePolicies?: Record<string, SyncPluginWakePolicy>;
}

export interface SyncPluginRuntime {
  syncPlugins: SyncPluginsPort;
  telegramSync: TelegramSyncPort;
  syncPluginWake: SyncPluginWakeController;
}

export function createSyncPluginRuntime(
  deps: SyncPluginRuntimeDeps,
): SyncPluginRuntime {
  const telegramPlugin = createTelegramSyncPlugin({
    credentials: deps.credentials,
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    listFolderTree: () => deps.tagsFolders.listFolderTree(),
  });

  const registry = createSyncPluginRegistry({
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    createItem: (input) => deps.itemsSearch.createItem(input),
    attachMediaFiles: (itemId, files) =>
      deps.mediaCover.attachMediaFiles(itemId, files),
    createCatalog: () => [telegramPlugin],
  });

  phaseBHandlerBindings.syncPluginPull = createSyncPluginPullHandler({
    syncNow: async (pluginId) => {
      const result = await registry.syncNow(pluginId);
      if (pluginId === TELEGRAM_PLUGIN_ID) {
        await markTelegramLastSyncAt({
          fs: deps.fs,
          dataDir: deps.dataDir,
          resolveActiveVaultId: deps.resolveActiveVaultId,
        });
      }
      return result;
    },
  });

  const syncPlugins: SyncPluginsPort = {
    async syncNow(pluginId) {
      return enqueueAndAwaitResult({
        queue: deps.requireJobs(),
        label: "syncPluginPull",
        takeResult: takeSyncPluginPullResult,
        enqueue: () => enqueueSyncPluginPull(deps.requireJobs(), { pluginId }),
      });
    },
  };

  const telegramSyncBase = createTelegramSyncService({
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    listFolderTree: () => deps.tagsFolders.listFolderTree(),
  });

  const syncPluginWakeInner = createSyncPluginWakeController({
    enqueueSyncPluginPull: (pluginId) =>
      enqueueSyncPluginPull(deps.requireJobs(), { pluginId }),
    onEnqueueFailure: (_pluginId, error) => {
      reportEnqueueFailure(deps.jobPermanentFailure, "syncPluginPull", error);
    },
  });

  const telegramWakeOverridden =
    deps.wakePolicies?.[TELEGRAM_PLUGIN_ID] !== undefined;

  const armTelegramWake = (
    enabled: boolean,
    syncIntervalMs = DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  ): void => {
    if (telegramWakeOverridden) {
      return;
    }
    syncPluginWakeInner.register(
      TELEGRAM_PLUGIN_ID,
      enabled
        ? { onVaultReady: true, intervalMs: syncIntervalMs }
        : { onVaultReady: false },
    );
  };

  const refreshTelegramWakeFromConfig = async (): Promise<void> => {
    if (telegramWakeOverridden) {
      return;
    }
    const vaultId = await deps.resolveActiveVaultId();
    const config = await loadTelegramPluginConfig(deps.fs, deps.dataDir, vaultId);
    armTelegramWake(config.enabled, config.sync_interval_ms);
  };

  for (const [pluginId, policy] of Object.entries(deps.wakePolicies ?? {})) {
    if (pluginId === TELEGRAM_PLUGIN_ID) {
      continue;
    }
    syncPluginWakeInner.register(pluginId, policy);
  }
  if (telegramWakeOverridden) {
    const override = deps.wakePolicies?.[TELEGRAM_PLUGIN_ID];
    if (!override) {
      throw new Error("telegram wake override missing after guard");
    }
    syncPluginWakeInner.register(TELEGRAM_PLUGIN_ID, override);
  } else {
    armTelegramWake(false);
  }

  const syncPluginWake: SyncPluginWakeController = {
    register: (pluginId, policy) =>
      syncPluginWakeInner.register(pluginId, policy),
    dispose: () => syncPluginWakeInner.dispose(),
    async notifyVaultReady() {
      await refreshTelegramWakeFromConfig();
      await syncPluginWakeInner.notifyVaultReady();
    },
  };

  const telegramSync: TelegramSyncPort = {
    getTelegramSyncSettings: () => telegramSyncBase.getTelegramSyncSettings(),
    validateTelegramBotToken: (input) =>
      telegramSyncBase.validateTelegramBotToken(input),
    async updateTelegramSyncSettings(patch) {
      const settings =
        await telegramSyncBase.updateTelegramSyncSettings(patch);
      armTelegramWake(settings.enabled, settings.sync_interval_ms);
      return settings;
    },
  };

  return { syncPlugins, telegramSync, syncPluginWake };
}
