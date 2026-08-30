import { createItemsDelete } from "./items-delete.js";
import { createItemsUpsertContent } from "./items-upsert-content.js";
import { createItemsUpsertMetadata } from "./items-upsert-metadata.js";
import type { SqlIndexDb } from "./types.js";

/** Thin compose of items SQL write operations (#921). */
export function createItemsPort(db: SqlIndexDb) {
  return {
    ...createItemsUpsertMetadata(db),
    ...createItemsUpsertContent(db),
    ...createItemsDelete(db),
  };
}

export type ItemsPort = ReturnType<typeof createItemsPort>;
