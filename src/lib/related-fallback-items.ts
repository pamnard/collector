import type { ItemFile } from "@collector/shared";
import { collectHydratedItems } from "./dashboard-display";
import { folderParentPath } from "./folder-actions";
import {
  RELATED_PANEL_SIZE,
  type RelatedTeaser,
} from "./related-teaser";
import type { CoverImageForm } from "./teaser-layout/cover-image-form";
import type { ProbeCoverImageForm } from "./teaser-layout/probe-cover-image-form";
import { resolveCoverSrc } from "../utils/item-cover-src";

/** Leaf → … → root `""` (root included once). */
export function relatedFolderPathChain(folderPath: string): string[] {
  const chain: string[] = [];
  let current = folderPath;
  for (;;) {
    chain.push(current);
    if (current === "") {
      break;
    }
    current = folderParentPath(current);
  }
  return chain;
}

/**
 * Walk folder → parents → root, collecting recent ids until `size`.
 * Returns exactly `size` ids, or `null` if the vault cannot fill the panel.
 */
export async function collectRelatedFallbackIds(options: {
  currentItemId: string;
  startFolderPath: string;
  size?: number;
  signal?: AbortSignal;
  listFolderItemIds: (
    folderPath: string,
    limit: number,
  ) => Promise<string[]>;
}): Promise<string[] | null> {
  const size = options.size ?? RELATED_PANEL_SIZE;
  if (size <= 0) {
    throw new Error("related fallback size must be positive");
  }

  const collected: string[] = [];
  const seen = new Set<string>([options.currentItemId]);

  for (const folderPath of relatedFolderPathChain(options.startFolderPath)) {
    if (options.signal?.aborted) {
      return null;
    }
    const remaining = size - collected.length;
    if (remaining <= 0) {
      break;
    }
    // +1 so the current item can be filtered out when it lives here.
    const ids = await options.listFolderItemIds(folderPath, remaining + 1);
    for (const id of ids) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      collected.push(id);
      if (collected.length === size) {
        return collected;
      }
    }
  }

  return null;
}

/**
 * Layout candidate from a hydrated item.
 * `thumbnail` must already be a display cover URL ({@link resolveCoverSrc}), or null.
 * `imageForm` must be measured from that URL (or null when absent/unread).
 */
export function relatedTeaserFromItem(
  item: ItemFile,
  thumbnail: string | null,
  imageForm: CoverImageForm | null,
): RelatedTeaser {
  if (thumbnail === null && imageForm !== null) {
    throw new Error(
      `related teaser ${item.id}: imageForm requires a resolved cover URL`,
    );
  }
  return {
    id: item.id,
    title: item.title,
    thumbnail,
    imageForm,
    description: item.description,
    createdAt: item.created_at,
    contentType: item.content_type,
  };
}

export type RelatedFallbackQueryIndex = (args: {
  folderPath: string;
  limit: number;
}) => Promise<string[]>;

export type RelatedFallbackHydrate = (
  ids: string[],
  options?: { signal?: AbortSignal },
) => AsyncIterable<ItemFile>;

/** Same batch API as collection grid covers (`UiSession.thumbnails`). */
export type RelatedFallbackResolveThumbnailPaths = (
  items: ItemFile[],
) => Promise<Map<string, string | null>>;

/**
 * Load exactly {@link RELATED_PANEL_SIZE} recent teasers from the item's
 * folder chain, or `null` when shortfall / empty hydrate.
 * Cover forms are probed in parallel for resolved URLs.
 */
export async function loadRelatedFallbackTeasers(options: {
  currentItemId: string;
  startFolderPath: string;
  size?: number;
  queryFolderIds: RelatedFallbackQueryIndex;
  hydrate: RelatedFallbackHydrate;
  resolveThumbnailPaths: RelatedFallbackResolveThumbnailPaths;
  probeCoverImageForm: ProbeCoverImageForm;
  signal?: AbortSignal;
}): Promise<RelatedTeaser[] | null> {
  const size = options.size ?? RELATED_PANEL_SIZE;

  const ids = await collectRelatedFallbackIds({
    currentItemId: options.currentItemId,
    startFolderPath: options.startFolderPath,
    size,
    signal: options.signal,
    listFolderItemIds: (folderPath, limit) =>
      options.queryFolderIds({ folderPath, limit }),
  });
  if (ids === null || options.signal?.aborted) {
    return null;
  }

  const byId = new Map<string, ItemFile>();
  await collectHydratedItems(
    options.hydrate(ids, { signal: options.signal }),
    (item) => {
      byId.set(item.id, item);
    },
  );
  if (options.signal?.aborted) {
    return null;
  }

  const ordered: ItemFile[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      return null;
    }
    ordered.push(item);
  }

  const paths = await options.resolveThumbnailPaths(ordered);
  if (options.signal?.aborted) {
    return null;
  }

  const resolved = ordered.map((item) => ({
    item,
    thumbnail: resolveCoverSrc(
      paths.get(item.id) ?? null,
      item.url ?? undefined,
    ),
  }));

  const imageForms = await Promise.all(
    resolved.map(({ thumbnail }) =>
      thumbnail === null
        ? Promise.resolve(null)
        : options.probeCoverImageForm(thumbnail, options.signal),
    ),
  );
  if (options.signal?.aborted) {
    return null;
  }

  return resolved.map(({ item, thumbnail }, index) =>
    relatedTeaserFromItem(item, thumbnail, imageForms[index] ?? null),
  );
}
