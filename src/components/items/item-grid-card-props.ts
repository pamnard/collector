import type { ItemFile } from "@collector/shared";
import type { TagWithCount } from "@collector/core";
import type { ItemThumbnailPixelSize } from "@collector/api";
import {
  itemCoverStamp,
  thumbnailPixelSizesEqual,
} from "../../lib/dashboard-commit.ts";

export interface ItemGridCardProps {
  item: ItemFile;
  /** undefined = paths still resolving; null = no file cover; string = path */
  thumbnailPath?: string | null;
  /** Host sharp.metadata size when path is known; undefined while resolving. */
  thumbnailSize?: ItemThumbnailPixelSize | null;
  tagsById: Map<string, TagWithCount>;
  onOpen: (itemId: string) => void;
}

function tagIdsEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Memo equality for masonry cards: every field the card renders (or uses for
 * cover resolve), not only cover stamp identity.
 */
export function itemGridCardPropsAreEqual(
  prev: ItemGridCardProps,
  next: ItemGridCardProps,
): boolean {
  return (
    prev.item.id === next.item.id &&
    prev.item.title === next.item.title &&
    prev.item.description === next.item.description &&
    prev.item.content_type === next.item.content_type &&
    prev.item.created_at === next.item.created_at &&
    prev.item.url === next.item.url &&
    tagIdsEqual(prev.item.tag_ids, next.item.tag_ids) &&
    itemCoverStamp(prev.item) === itemCoverStamp(next.item) &&
    prev.thumbnailPath === next.thumbnailPath &&
    thumbnailPixelSizesEqual(prev.thumbnailSize, next.thumbnailSize) &&
    prev.tagsById === next.tagsById &&
    prev.onOpen === next.onOpen
  );
}
