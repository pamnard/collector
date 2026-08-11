import type { SimilarItemHit } from "@collector/api";
import type { ItemFile } from "@collector/shared";
import { collectHydratedItems } from "./dashboard-display";
import {
  RELATED_PANEL_SIZE,
  relatedTeaserFromItem,
  type RelatedTeaser,
} from "./related-teaser";
import type { ProbeCoverImageForm } from "./teaser-layout/probe-cover-image-form";
import { resolveCoverSrc } from "../utils/item-cover-src";

export type RelatedSemanticFindSimilar = (
  itemId: string,
  limit: number,
) => Promise<SimilarItemHit[]>;

export type RelatedSemanticHydrate = (
  ids: string[],
  options?: { signal?: AbortSignal },
) => AsyncIterable<ItemFile>;

export type RelatedSemanticResolveThumbnailPaths = (
  items: ItemFile[],
) => Promise<Map<string, string | null>>;

/**
 * Load ranked semantic teasers for the item detail panel (#414).
 * Returns `null` when there are no hits, hydrate shortfall, or abort.
 */
export async function loadRelatedSemanticTeasers(options: {
  currentItemId: string;
  size?: number;
  findSimilarItems: RelatedSemanticFindSimilar;
  hydrate: RelatedSemanticHydrate;
  resolveThumbnailPaths: RelatedSemanticResolveThumbnailPaths;
  probeCoverImageForm: ProbeCoverImageForm;
  signal?: AbortSignal;
}): Promise<RelatedTeaser[] | null> {
  const size = options.size ?? RELATED_PANEL_SIZE;
  if (size <= 0) {
    throw new Error("related semantic size must be positive");
  }

  const hits = await options.findSimilarItems(options.currentItemId, size);
  if (options.signal?.aborted || hits.length === 0) {
    return null;
  }

  const ids = hits.map((hit) => hit.id);

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
