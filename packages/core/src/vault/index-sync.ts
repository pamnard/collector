import type { SyncReport, VaultContext } from "../adapters/types.js";
import { migrateVaultSchema } from "./schema-migrate.js";
import { syncIndexFromFilesystem } from "./operations.js";
import { syncTagsToIndex } from "./tag-operations.js";

export interface VaultIndexSyncReport extends SyncReport {
  vaultId: string;
}

/** Rebuild one vault's search index from on-disk files (vault row → tags → items). */
export async function syncVaultIndexFromFilesystem(
  ctx: VaultContext,
  vaultPath: string,
): Promise<VaultIndexSyncReport> {
  const meta = await migrateVaultSchema(ctx.fs, vaultPath);
  await ctx.index.upsertVault(meta, vaultPath);
  await syncTagsToIndex(ctx, vaultPath, meta.id);
  const report = await syncIndexFromFilesystem(ctx, vaultPath, meta.id);
  return { vaultId: meta.id, ...report };
}
