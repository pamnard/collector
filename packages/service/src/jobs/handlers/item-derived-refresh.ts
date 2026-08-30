import {
  itemMarkdownPath,
  readItemFile,
  runItemDerivedLocalizeRefresh,
  upsertItemIndexFromVault,
  pruneReleasedTagsAfterIndexRefresh,
  type VaultContext,
} from "@collector/core";
import {
  itemDerivedRefreshIdempotencyKey,
  itemDerivedRefreshJobType,
  type ItemDerivedRefreshJobPayload,
} from "@collector/shared";
import type { JobQueue, EnqueueResult } from "../job-queue.js";
import type { TypedJobHandler } from "../job-registry.js";
import type { JobHandlerResult } from "../job-types.js";
import type { VaultPresentationChangedPayload } from "../../vault-presentation-changed.js";
import type { LocalizeItemRemoteDisplayAssets } from "../../localize-item-remote-display-assets.js";

export type ItemDerivedRefreshEnqueueInput = ItemDerivedRefreshJobPayload;

export function createItemDerivedRefreshHandler(deps: {
  getContext: () => VaultContext;
  localizeRemoteDisplayAssets: LocalizeItemRemoteDisplayAssets;
  onVaultPresentationChanged?: (
    payload: VaultPresentationChangedPayload,
  ) => void;
}): TypedJobHandler<typeof itemDerivedRefreshJobType.payload> {
  return async (job): Promise<JobHandlerResult> => {
    const payload = job.payload;
    const ctx = deps.getContext();

    const localizeOutcome = await runItemDerivedLocalizeRefresh(
      ctx,
      {
        vaultId: payload.vaultId,
        vaultPath: payload.vaultPath,
        itemId: payload.itemId,
        contentRevision: payload.contentRevision,
        fileMtimeMs: payload.fileMtimeMs,
        itemUrl: payload.itemUrl,
      },
      deps.localizeRemoteDisplayAssets,
    );

    const docPath = itemMarkdownPath(payload.vaultPath, payload.itemId);
    if (!(await ctx.fs.exists(docPath))) {
      // Item deleted before worker ran: release any remaining index tags (#935).
      const { releasedTagIds } = await upsertItemIndexFromVault(
        ctx,
        payload.vaultPath,
        payload.vaultId,
        payload.itemId,
        payload.contentRevision,
        payload.fileMtimeMs,
      );
      await pruneReleasedTagsAfterIndexRefresh(
        ctx,
        payload.vaultPath,
        payload.vaultId,
        releasedTagIds,
      );
      return { status: "ok" };
    }

    const fileStat = await ctx.fs.stat(docPath);
    if (fileStat.mtimeMs === null) {
      throw new Error(
        `itemDerivedRefresh: missing file mtime for ${payload.itemId}`,
      );
    }

    const item = await readItemFile(
      ctx.fs,
      payload.vaultPath,
      payload.itemId,
      payload.vaultId,
    );

    if (localizeOutcome === "markdown" || localizeOutcome === "media") {
      deps.onVaultPresentationChanged?.({
        vaultId: payload.vaultId,
        kind: "itemUpserted",
        itemId: payload.itemId,
        folderPath: item.folder_path,
      });
    }

    if (localizeOutcome === "media") {
      deps.onVaultPresentationChanged?.({
        vaultId: payload.vaultId,
        kind: "itemDerivedComplete",
        itemId: payload.itemId,
        folderPath: item.folder_path,
      });
      return { status: "ok" };
    }

    const { releasedTagIds } = await upsertItemIndexFromVault(
      ctx,
      payload.vaultPath,
      payload.vaultId,
      payload.itemId,
      item.content_revision,
      fileStat.mtimeMs,
    );

    await pruneReleasedTagsAfterIndexRefresh(
      ctx,
      payload.vaultPath,
      payload.vaultId,
      releasedTagIds,
    );

    deps.onVaultPresentationChanged?.({
      vaultId: payload.vaultId,
      kind: "itemDerivedComplete",
      itemId: payload.itemId,
      folderPath: item.folder_path,
    });

    return { status: "ok" };
  };
}

export function enqueueItemDerivedRefresh(
  queue: JobQueue,
  payload: ItemDerivedRefreshJobPayload,
): Promise<EnqueueResult> {
  return queue.enqueue({
    type: "itemDerivedRefresh",
    payload,
    idempotencyKey: itemDerivedRefreshIdempotencyKey(payload),
  });
}
