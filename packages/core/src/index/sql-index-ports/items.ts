import { createItemsDelete } from "./items-delete.js";
import { createItemsUpsertContent } from "./items-upsert-content.js";
import { createItemsUpsertMetadata } from "./items-upsert-metadata.js";
import type { SqlIndexDb } from "./types.js";

export function createItemsPort(db: SqlIndexDb) {
  return {
    ...createItemsUpsertMetadata(db),
    ...createItemsUpsertContent(db),
    ...createItemsDelete(db),
  };
}

export type ItemsPort = ReturnType<typeof createItemsPort>;
