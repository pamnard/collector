import type { TagWithCount } from "../domain.js";
import type { ServiceSubscribeHandlers, Subscription } from "./shared.js";

/**
 * Tags port (#361 / #842).
 * Aggregated lists only — catalog entries are derived from document writes.
 * Assign tag names on items; do not create/rename/delete catalog rows here.
 */
export interface TagsPort {
  subscribeTags(
    onUpdate: (tags: TagWithCount[]) => void,
    handlers?: ServiceSubscribeHandlers,
    signal?: AbortSignal,
  ): Subscription;
  listTags(): Promise<TagWithCount[]>;
}
