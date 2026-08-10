import type { ItemFile } from "@collector/shared";
import { collectHydratedItems } from "./dashboard-display";
import { folderParentPath } from "./folder-actions";
import {
  RELATED_PANEL_SIZE,
  type RelatedTeaser,
} from "./related-teaser";

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

export function relatedTeaserFromItem(item: ItemFile): RelatedTeaser {
  return {
    id: item.id,
    title: item.title,
    thumbnail: item.thumbnail ?? null,
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

/**
 * Load exactly {@link RELATED_PANEL_SIZE} recent teasers from the item's
 * folder chain, or `null` when shortfall / empty hydrate.
 */
export async function loadRelatedFallbackTeasers(options: {
  currentItemId: string;
  startFolderPath: string;
  size?: number;
  queryFolderIds: RelatedFallbackQueryIndex;
  hydrate: RelatedFallbackHydrate;
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

  const teasers: RelatedTeaser[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) {
      return null;
    }
    teasers.push(relatedTeaserFromItem(item));
  }
  return teasers;
}
