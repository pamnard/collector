import {
  itemMarkdownPath,
  parseDocumentMarkdown,
  partitionDocumentFrontmatter,
  runItemDerivedLocalizeRefresh,
  upsertItemIndexFromVault,
  pruneReleasedTagsAfterIndexRefresh,
  type VaultContext,
} from "@collector/core";
import {
  folderPathFromItemPath,
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

function contentRevisionFromDocumentMarkdown(raw: string): number | null {
  const { known } = partitionDocumentFrontmatter(
    parseDocumentMarkdown(raw).frontmatter,
  );
  return known.content_revision ?? null;
}

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
    const folderPath = folderPathFromItemPath(payload.itemId);

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
        {
          previousTagIds: payload.previousTagIds,
        },
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

    if (localizeOutcome === "markdown" || localizeOutcome === "media") {
      deps.onVaultPresentationChanged?.({
        vaultId: payload.vaultId,
        kind: "itemUpserted",
        itemId: payload.itemId,
        folderPath,
      });
    }

    if (localizeOutcome === "media") {
      // Media-only localize already ran syncIndexItemsFromFilesystem; tag rows
      // were pinned on the write path. Skip a second full upsert.
      deps.onVaultPresentationChanged?.({
        vaultId: payload.vaultId,
        kind: "itemDerivedComplete",
        itemId: payload.itemId,
        folderPath,
      });
      return { status: "ok" };
    }

    // Use on-disk content_revision (may have been bumped by localize). Passing
    // the job's pre-localize revision after a pin that advanced the index
    // would make upsertItemIndexFromVault return stale and skip FTS.
    const raw = await ctx.fs.readText(docPath);
    const contentRevision =
      contentRevisionFromDocumentMarkdown(raw) ?? payload.contentRevision;

    // Upsert from vault bytes (itemFileFromDocumentMarkdown ensures missing
    // catalog tags). Do not call strict readItemFile — unresolved FM tags
    // would brick the job before repair.
    const { releasedTagIds } = await upsertItemIndexFromVault(
      ctx,
      payload.vaultPath,
      payload.vaultId,
      payload.itemId,
      contentRevision,
      fileStat.mtimeMs,
      {
        previousTagIds: payload.previousTagIds,
      },
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
      folderPath,
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
