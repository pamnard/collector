/**
 * Async derived localize step for itemDerivedRefresh jobs (#768).
 */

import type { ItemSyncMeta, VaultContext } from "../adapters/types.js";
import {
  bumpContentRevisionInDocumentMarkdown,
} from "./frontmatter.js";
import { readItemRawMarkdown } from "./item-io.js";
import { writeItemRawMarkdown } from "./item-operations.js";
import { itemMarkdownPath } from "./paths.js";
import {
  mightNeedRemoteDisplayAssetLocalization,
  type LocalizeRemoteDisplayAssetsResult,
} from "./remote-display-assets.js";
import { syncIndexItemsFromFilesystem } from "./item-index-sync.js";
import { isIndexAheadOfSnapshot } from "./item-index-refresh.js";

export type ItemDerivedLocalizeRefreshInput = {
  vaultId: string;
  vaultPath: string;
  itemId: string;
  contentRevision: number;
  fileMtimeMs: number;
  itemUrl?: string | null;
};

export type ItemDerivedLocalizeRefreshOutcome =
  | "missing"
  | "stale"
  | "noop"
  | "markdown"
  | "media";

export type LocalizeRemoteDisplayAssetsPort = (input: {
  itemId: string;
  rawMarkdown: string;
  itemUrl?: string | null;
}) => Promise<LocalizeRemoteDisplayAssetsResult>;

export function isStaleItemDerivedLocalizeJob(
  indexed: ItemSyncMeta,
  expected: Pick<ItemDerivedLocalizeRefreshInput, "contentRevision" | "fileMtimeMs">,
): boolean {
  return isIndexAheadOfSnapshot(
    indexed,
    expected.contentRevision,
    expected.fileMtimeMs,
  );
}

/**
 * Localize remote display assets in the worker. When markdown changes, bump
 * revision and write; when only media/cover changes, re-sync the index row.
 */
export async function runItemDerivedLocalizeRefresh(
  ctx: VaultContext,
  input: ItemDerivedLocalizeRefreshInput,
  localizeRemoteDisplayAssets: LocalizeRemoteDisplayAssetsPort,
): Promise<ItemDerivedLocalizeRefreshOutcome> {
  const { vaultId, vaultPath, itemId, contentRevision, fileMtimeMs, itemUrl } =
    input;

  const docPath = itemMarkdownPath(vaultPath, itemId);
  if (!(await ctx.fs.exists(docPath))) {
    return "missing";
  }

  const indexed = await ctx.index.listItemSyncMetaByIds(vaultId, [itemId]);
  const meta = indexed[0];
  if (meta && isStaleItemDerivedLocalizeJob(meta, { contentRevision, fileMtimeMs })) {
    return "stale";
  }

  const rawMarkdown = await readItemRawMarkdown(ctx.fs, vaultPath, itemId);
  if (!mightNeedRemoteDisplayAssetLocalization(rawMarkdown, itemUrl)) {
    return "noop";
  }

  const localized = await localizeRemoteDisplayAssets({
    itemId,
    rawMarkdown,
    itemUrl,
  });

  if (!localized.changed) {
    return "noop";
  }

  if (localized.text !== rawMarkdown) {
    const bumped = bumpContentRevisionInDocumentMarkdown(localized.text);
    await writeItemRawMarkdown(ctx, vaultPath, vaultId, itemId, bumped, {
      deferIndexRefresh: true,
    });
    return "markdown";
  }

  const report = await syncIndexItemsFromFilesystem(
    ctx,
    vaultPath,
    vaultId,
    [itemId],
  );
  if (report.errors.length > 0) {
    const summary = report.errors.map((entry) => entry.message).join("; ");
    throw new Error(
      `runItemDerivedLocalizeRefresh: index sync failed for ${itemId}: ${summary}`,
    );
  }
  return "media";
}
