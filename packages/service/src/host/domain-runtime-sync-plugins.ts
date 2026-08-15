/**
 * Sync plugin registry + Telegram wake wiring for domain runtime (#419).
 */

import type {
  AttachMediaFileInput,
  CreateItemInput,
  CredentialsPort,
  SyncPluginsPort,
  TelegramSyncPort,
} from "@collector/api";
import type { FileSystemAdapter } from "@collector/core";
import type { FolderTreeNode, ItemFile } from "@collector/shared";
import { createSyncPluginRegistry } from "../sync-plugin-registry.js";
import {
  createSyncPluginWakeController,
  type SyncPluginWakePolicy,
  type SyncPluginWakeController,
} from "../sync-plugin-wake.js";
import {
  DEFAULT_TELEGRAM_SYNC_INTERVAL_MS,
  TELEGRAM_PLUGIN_ID,
  createTelegramSyncPlugin,
  createTelegramSyncService,
  loadTelegramPluginConfig,
  markTelegramLastSyncAt,
} from "../plugins/telegram/index.js";
import type { JobQueue } from "../jobs/job-queue.js";
import {
  reportEnqueueFailure,
  type JobPermanentFailureStore,
} from "../job-permanent-failure.js";
import { phaseBHandlerBindings } from "../jobs/phase-b-bindings.js";
import {
  createSyncPluginPullHandler,
  enqueueSyncPluginPull,
  takeSyncPluginPullResult,
} from "../jobs/handlers/sync-plugin-pull.js";
import { enqueueAndAwaitResult } from "../jobs/job-wait.js";

export type DomainRuntimeSyncPluginsDeps = {
  credentials: CredentialsPort;
  fs: FileSystemAdapter;
  dataDir: string;
  resolveActiveVaultId: () => Promise<string>;
  listFolderTree: () => Promise<FolderTreeNode[]>;
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  requireJobs: () => JobQueue;
  jobPermanentFailure: JobPermanentFailureStore;
  wakePolicies?: Record<string, SyncPluginWakePolicy>;
};

export function createDomainRuntimeSyncPlugins(
  deps: DomainRuntimeSyncPluginsDeps,
): {
  syncPlugins: SyncPluginsPort;
  telegramSync: TelegramSyncPort;
  syncPluginWake: SyncPluginWakeController;
} {
  const {
    credentials,
    fs,
    dataDir,
    resolveActiveVaultId,
    listFolderTree,
    createItem,
    attachMediaFiles,
    requireJobs,
    jobPermanentFailure,
    wakePolicies,
  } = deps;

  const telegramPlugin = createTelegramSyncPlugin({
    credentials,
    fs,
    dataDir,
    resolveActiveVaultId,
    listFolderTree,
  });

  const registry = createSyncPluginRegistry({
    fs,
    dataDir,
    resolveActiveVaultId,
    createItem,
    attachMediaFiles,
    createCatalog: () => [telegramPlugin],
  });

  phaseBHandlerBindings.syncPluginPull = createSyncPluginPullHandler({
    syncNow: async (pluginId) => {
      const result = await registry.syncNow(pluginId);
      if (pluginId === TELEGRAM_PLUGIN_ID) {
        await markTelegramLastSyncAt({
          fs,
          dataDir,
          resolveActiveVaultId,
        });
      }
      return result;
    },
  });

  const syncPlugins: SyncPluginsPort = {
    async syncNow(pluginId) {
      return enqueueAndAwaitResult({
        queue: requireJobs(),
        label: "syncPluginPull",
        takeResult: takeSyncPluginPullResult,
        enqueue: () => enqueueSyncPluginPull(requireJobs(), { pluginId }),
      });
    },
  };

  const telegramSyncBase = createTelegramSyncService({
    fs,
    dataDir,
    resolveActiveVaultId,
    listFolderTree,
  });

  const syncPluginWakeInner = createSyncPluginWakeController({
    enqueueSyncPluginPull: (pluginId) =>
      enqueueSyncPluginPull(requireJobs(), { pluginId }),
    onEnqueueFailure: (_pluginId, error) => {
      reportEnqueueFailure(jobPermanentFailure, "syncPluginPull", error);
    },
  });

  const telegramWakeOverridden =
    wakePolicies?.[TELEGRAM_PLUGIN_ID] !== undefined;

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
    const vaultId = await resolveActiveVaultId();
    const config = await loadTelegramPluginConfig(fs, dataDir, vaultId);
    armTelegramWake(config.enabled, config.sync_interval_ms);
  };

  for (const [pluginId, policy] of Object.entries(wakePolicies ?? {})) {
    if (pluginId === TELEGRAM_PLUGIN_ID) {
      continue;
    }
    syncPluginWakeInner.register(pluginId, policy);
  }
  if (telegramWakeOverridden) {
    const override = wakePolicies?.[TELEGRAM_PLUGIN_ID];
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
