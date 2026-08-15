import type { SqlSelector } from "../index/sql-index.js";

export type VaultIdTitleRow = { id: string; title: string };

type CatalogEntry = {
  rows: ReadonlyArray<VaultIdTitleRow>;
};

type SessionState = {
  byVault: Map<string, CatalogEntry>;
  /** Per-vault generation; bumped on per-vault invalidate. */
  epochByVault: Map<string, number>;
  /** Session-wide generation; bumped on invalidate-all. */
  allEpoch: number;
};

/** Per SQL session → vault id/title catalog (#661). */
const sessionsByDb = new WeakMap<object, SessionState>();

function sessionFor(db: object): SessionState {
  let session = sessionsByDb.get(db);
  if (!session) {
    session = {
      byVault: new Map(),
      epochByVault: new Map(),
      allEpoch: 0,
    };
    sessionsByDb.set(db, session);
  }
  return session;
}

function vaultEpoch(session: SessionState, vaultId: string): number {
  return session.epochByVault.get(vaultId) ?? 0;
}

function bumpVaultEpoch(session: SessionState, vaultId: string): void {
  session.epochByVault.set(vaultId, vaultEpoch(session, vaultId) + 1);
}

/**
 * Load vault id/title rows once per SQL session; reuse until invalidated.
 * Callers must not mutate the returned array.
 *
 * Uses epoch/generation so an in-flight SELECT that loses a race with
 * invalidate does not populate the cache with stale rows.
 */
export async function loadVaultIdTitleCatalog(
  db: SqlSelector,
  vaultId: string,
): Promise<ReadonlyArray<VaultIdTitleRow>> {
  const session = sessionFor(db);

  for (;;) {
    const hit = session.byVault.get(vaultId);
    if (hit) {
      return hit.rows;
    }

    const epochAtStart = vaultEpoch(session, vaultId);
    const allEpochAtStart = session.allEpoch;

    const rows = await db.select<VaultIdTitleRow>(
      "SELECT id, title FROM items WHERE vault_id = ?",
      [vaultId],
    );
    const cached: ReadonlyArray<VaultIdTitleRow> = Object.freeze(
      rows.map((row) => ({ id: row.id, title: row.title })),
    );

    if (
      session.allEpoch !== allEpochAtStart ||
      vaultEpoch(session, vaultId) !== epochAtStart
    ) {
      // Invalidated during SELECT — retry; do not write stale data.
      continue;
    }

    const raced = session.byVault.get(vaultId);
    if (raced) {
      return raced.rows;
    }

    session.byVault.set(vaultId, { rows: cached });
    return cached;
  }
}

/** Drop cached catalog for one vault (title/id mutations, sync writes). */
export function invalidateVaultIdTitleCatalog(
  db: object,
  vaultId: string,
): void {
  const session = sessionsByDb.get(db);
  if (!session) {
    return;
  }
  session.byVault.delete(vaultId);
  bumpVaultEpoch(session, vaultId);
}

/** Drop all vault catalogs for a SQL session (delete item without vault, rewrite). */
export function invalidateAllVaultIdTitleCatalogs(db: object): void {
  const session = sessionsByDb.get(db);
  if (!session) {
    return;
  }
  session.byVault.clear();
  session.allEpoch += 1;
}

/** Test helper: whether a vault catalog is currently cached. */
export function hasVaultIdTitleCatalogCache(
  db: object,
  vaultId: string,
): boolean {
  return sessionsByDb.get(db)?.byVault.has(vaultId) === true;
}
