import type {
  AttachMediaFileInput,
  CreateItemInput,
  SyncPluginsPort,
  TelegramSyncPort,
} from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import { reportEnqueueFailure } from "../../job-permanent-failure.js";
import type { JobPermanentFailureStore } from "../../job-permanent-failure.js";
import {
  createSyncPluginPullHandler,
  enqueueSyncPluginPull,
  takeSyncPluginPullResult,
} from "../../jobs/handlers/sync-plugin-pull.js";
import { phaseBHandlerBindings } from "../../jobs/phase-b-bindings.js";
import type { JobQueue } from "../../jobs/job-queue.js";
import { enqueueAndAwaitResult } from "../../jobs/job-wait.js";
import {
  DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  TELEGRAM_PLUGIN_ID,
  createTelegramSyncPlugin,
  createTelegramSyncService,
  loadTelegramPluginConfig,
  markTelegramLastSyncAt,
} from "../../plugins/telegram/index.js";
import { createSyncPluginRegistry } from "../../sync-plugin-registry.js";
import {
  createSyncPluginWakeController,
  type SyncPluginWakeController,
  type SyncPluginWakePolicy,
} from "../../sync-plugin-wake.js";
import type { createCredentialsService } from "../../credentials.js";
import type { createTagsFoldersService } from "../../tags-folders.js";

export function createHostSyncPlugins(deps: {
  credentials: ReturnType<typeof createCredentialsService>;
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  listFolderTree: ReturnType<typeof createTagsFoldersService>["listFolderTree"];
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
  wakePolicies?: Record<string, SyncPluginWakePolicy>;
}): {
  syncPlugins: SyncPluginsPort;
  telegramSync: TelegramSyncPort;
  syncPluginWake: SyncPluginWakeController;
} {
  const telegramPlugin = createTelegramSyncPlugin({
    credentials: deps.credentials,
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    listFolderTree: deps.listFolderTree,
  });

  const registry = createSyncPluginRegistry({
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    createItem: deps.createItem,
    attachMediaFiles: deps.attachMediaFiles,
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
        enqueue: () =>
          enqueueSyncPluginPull(deps.requireJobs(), { pluginId }),
      });
    },
  };

  const telegramSyncBase = createTelegramSyncService({
    fs: deps.fs,
    dataDir: deps.dataDir,
    resolveActiveVaultId: deps.resolveActiveVaultId,
    listFolderTree: deps.listFolderTree,
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
    const config = await loadTelegramPluginConfig(
      deps.fs,
      deps.dataDir,
      vaultId,
    );
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
