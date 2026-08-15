import type { VaultContext } from "@collector/core";
import type { AttachMediaFileInput, CreateItemInput } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { createDropImportBatchHandler } from "../../jobs/handlers/drop-import-batch.js";
import { createGenerateCoverHandler } from "../../jobs/handlers/generate-cover.js";
import { createRefreshEmbeddingsHandler } from "../../jobs/handlers/refresh-embeddings.js";
import { createReindexVaultBatchHandler } from "../../jobs/handlers/reindex-vault-batch.js";
import { createVaultIndexSyncHandler } from "../../jobs/handlers/vault-index-sync.js";
import { phaseBHandlerBindings } from "../../jobs/phase-b-bindings.js";
import { generateCoverFromMedia } from "../node-cover.js";

export function bindHostPhaseBHandlers(deps: {
  startVaultIndexSync: (vaultId: string, vaultPath: string) => Promise<void>;
  getContext: () => VaultContext;
  notifyWatchItemsSynced: (vaultId: string) => void;
  scheduleLayoutGuard: (vaultId: string, vaultPath: string) => void;
  requireActiveVaultPath: (vaultId: string) => Promise<string>;
  onVaultPresentationChanged: (vaultId: string) => void;
  refreshEmbeddings: (
    inputs: import("@collector/core").ItemEmbeddingRefreshInput[],
  ) => Promise<void>;
  createItem: (input: CreateItemInput) => Promise<ItemFile>;
  attachMediaFiles: (
    itemId: string,
    files: AttachMediaFileInput[],
  ) => Promise<unknown>;
  updateItemSource: (itemId: string, raw: string) => Promise<ItemFile>;
}): void {
  phaseBHandlerBindings.vaultIndexSync = createVaultIndexSyncHandler({
    startVaultIndexSync: deps.startVaultIndexSync,
  });
  phaseBHandlerBindings.reindexVaultBatch = createReindexVaultBatchHandler({
    getContext: deps.getContext,
    onItemsSynced: deps.notifyWatchItemsSynced,
    onWatchApplied: deps.scheduleLayoutGuard,
  });
  phaseBHandlerBindings.generateCover = createGenerateCoverHandler({
    getContext: deps.getContext,
    resolveVaultPath: deps.requireActiveVaultPath,
    generateCoverFromMedia,
    onVaultPresentationChanged: deps.onVaultPresentationChanged,
  });
  phaseBHandlerBindings.refreshEmbeddings = createRefreshEmbeddingsHandler({
    refresh: deps.refreshEmbeddings,
  });
  phaseBHandlerBindings.dropImportBatch = createDropImportBatchHandler({
    createItem: deps.createItem,
    attachMediaFiles: deps.attachMediaFiles,
    updateItemSource: deps.updateItemSource,
  });
}
