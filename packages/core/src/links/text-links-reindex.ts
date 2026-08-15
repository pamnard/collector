import type { SqlSelector } from "../index/sql-index.js";
import type { TextLinkResolveContext } from "./resolve-text-links.js";
import { loadVaultIdTitleCatalog } from "./vault-id-title-catalog.js";

/** Shared vault id/title lookups for text-link resolve (#708). */
export type TextLinkCatalogIndexes = {
  idExists: (itemId: string) => boolean;
  idsByTitle: (title: string) => string[];
};

/** Build catalog id/title indexes once; reuse across sourceItemId values. */
export function textLinkCatalogIndexesFromItems(
  items: ReadonlyArray<{ id: string; title: string }>,
): TextLinkCatalogIndexes {
  const idSet = new Set(items.map((item) => item.id));
  const titleToIds = new Map<string, string[]>();
  for (const item of items) {
    const list = titleToIds.get(item.title);
    if (list) {
      list.push(item.id);
    } else {
      titleToIds.set(item.title, [item.id]);
    }
  }
  return {
    idExists: (id) => idSet.has(id),
    idsByTitle: (title) => titleToIds.get(title) ?? [],
  };
}

/** Bind a source item id onto shared catalog indexes. */
export function textLinkResolveContextFromIndexes(
  sourceItemId: string,
  indexes: TextLinkCatalogIndexes,
): TextLinkResolveContext {
  return {
    sourceItemId,
    idExists: indexes.idExists,
    idsByTitle: indexes.idsByTitle,
  };
}

/** Build resolve maps from a light id/title catalog (no full ItemFile load). */
export function textLinkResolveContextFromItems(
  sourceItemId: string,
  items: ReadonlyArray<{ id: string; title: string }>,
): TextLinkResolveContext {
  return textLinkResolveContextFromIndexes(
    sourceItemId,
    textLinkCatalogIndexesFromItems(items),
  );
}

export async function buildTextLinkResolveContext(
  db: SqlSelector,
  sourceItemId: string,
): Promise<TextLinkResolveContext | null> {
  const sourceRows = await db.select<{ vault_id: string }>(
    "SELECT vault_id FROM items WHERE id = ?",
    [sourceItemId],
  );
  const vaultId = sourceRows[0]?.vault_id;
  if (!vaultId) {
    return null;
  }

  const rows = await loadVaultIdTitleCatalog(db, vaultId);
  return textLinkResolveContextFromItems(sourceItemId, rows);
}
