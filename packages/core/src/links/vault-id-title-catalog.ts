import type { SqlSelector } from "../index/sql-index.js";

export type VaultIdTitleRow = { id: string; title: string };

type CatalogEntry = {
  rows: ReadonlyArray<VaultIdTitleRow>;
};

/** Per SQL session → vaultId → id/title catalog (#661). */
const catalogsByDb = new WeakMap<object, Map<string, CatalogEntry>>();

function vaultMapFor(db: object): Map<string, CatalogEntry> {
  let byVault = catalogsByDb.get(db);
  if (!byVault) {
    byVault = new Map();
    catalogsByDb.set(db, byVault);
  }
  return byVault;
}

/**
 * Load vault id/title rows once per SQL session; reuse until invalidated.
 * Callers must not mutate the returned array.
 */
export async function loadVaultIdTitleCatalog(
  db: SqlSelector,
  vaultId: string,
): Promise<ReadonlyArray<VaultIdTitleRow>> {
  const byVault = vaultMapFor(db);
  const hit = byVault.get(vaultId);
  if (hit) {
    return hit.rows;
  }

  const rows = await db.select<VaultIdTitleRow>(
    "SELECT id, title FROM items WHERE vault_id = ?",
    [vaultId],
  );
  const cached: ReadonlyArray<VaultIdTitleRow> = Object.freeze(
    rows.map((row) => ({ id: row.id, title: row.title })),
  );
  byVault.set(vaultId, { rows: cached });
  return cached;
}

/** Drop cached catalog for one vault (title/id mutations, sync writes). */
export function invalidateVaultIdTitleCatalog(
  db: object,
  vaultId: string,
): void {
  catalogsByDb.get(db)?.delete(vaultId);
}

/** Drop all vault catalogs for a SQL session (delete item without vault, rewrite). */
export function invalidateAllVaultIdTitleCatalogs(db: object): void {
  catalogsByDb.get(db)?.clear();
}

/** Test helper: whether a vault catalog is currently cached. */
export function hasVaultIdTitleCatalogCache(
  db: object,
  vaultId: string,
): boolean {
  return catalogsByDb.get(db)?.has(vaultId) === true;
}
