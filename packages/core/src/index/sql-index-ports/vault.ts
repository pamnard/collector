import type { VaultMeta } from "@collector/shared";
import { invalidateVaultIdTitleCatalog } from "../../links/vault-id-title-catalog.js";
import type { SqlIndexDb } from "./types.js";

export function createVaultPort(db: SqlIndexDb) {
  return {
    async upsertVault(meta: VaultMeta, vaultPath: string): Promise<void> {
      await db.execute(
        `INSERT INTO vaults (
          id, path, name, description, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path,
          name = excluded.name,
          description = excluded.description,
          is_default = excluded.is_default,
          updated_at = excluded.updated_at`,
        [
          meta.id,
          vaultPath,
          meta.name,
          meta.description,
          meta.is_default ? 1 : 0,
          meta.created_at,
          meta.updated_at,
        ],
      );
    },

    async deleteVault(vaultId: string): Promise<void> {
      await db.execute("DELETE FROM vaults WHERE id = ?", [vaultId]);
      invalidateVaultIdTitleCatalog(db, vaultId);
    },
  };
}

export type VaultPort = ReturnType<typeof createVaultPort>;
