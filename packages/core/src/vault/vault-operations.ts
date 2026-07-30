import type { VaultMeta } from "@collector/shared";
import { SCHEMA_VERSION } from "@collector/shared";
import type { CreateVaultInput, VaultContext } from "../adapters/types.js";
import { createId, nowIso } from "../util/ids.js";
import { writeVaultMeta } from "./item-io.js";
import { writeTagsFile } from "./tag-io.js";
import { vaultRoot, vaultsRoot } from "./paths.js";

export async function createVault(
  ctx: VaultContext,
  dataDir: string,
  input: CreateVaultInput,
): Promise<{ meta: VaultMeta; path: string }> {
  const vaultId = createId();
  const timestamp = nowIso();
  const meta: VaultMeta = {
    id: vaultId,
    name: input.name,
    description: input.description ?? "",
    is_default: input.isDefault ?? false,
    schema_version: SCHEMA_VERSION,
    settings: {},
    created_at: timestamp,
    updated_at: timestamp,
  };

  const root = vaultsRoot(dataDir);
  const vaultPath = vaultRoot(root, vaultId);

  await ctx.fs.mkdir(vaultPath);
  await writeVaultMeta(ctx.fs, vaultPath, meta);
  await writeTagsFile(ctx.fs, vaultPath, { tags: [] });
  await ctx.index.upsertVault(meta, vaultPath);

  return { meta, path: vaultPath };
}
