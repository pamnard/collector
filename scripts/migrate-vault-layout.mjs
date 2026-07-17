/**
 * One-shot: convert a legacy vault (`items/<uuid>/` + optional folders.json)
 * to the tree layout (path-as-id `.md` + `*.media/` sidecars).
 *
 * Not part of app startup. Usage:
 *   npm run build --workspace @collector/core
 *   node scripts/migrate-vault-layout.mjs /absolute/path/to/vault
 */
import { resolve } from "node:path";
import { NodeFileSystemAdapter } from "../packages/core/dist/adapters/node-fs.js";
import { migrateVaultSchema } from "../packages/core/dist/vault/schema-migrate.js";
import { legacyItemsRoot } from "../packages/core/dist/vault/paths.js";

const vaultArg = process.argv[2];
if (!vaultArg) {
  console.error("Usage: node scripts/migrate-vault-layout.mjs <vault-path>");
  process.exit(1);
}

const vaultPath = resolve(vaultArg);
const fs = new NodeFileSystemAdapter();

if (!(await fs.exists(vaultPath))) {
  console.error(`Vault path does not exist: ${vaultPath}`);
  process.exit(1);
}

const metaPath = `${vaultPath.replace(/\\/g, "/")}/vault.meta.json`;
if (!(await fs.exists(metaPath))) {
  console.error(`Not a vault (missing vault.meta.json): ${vaultPath}`);
  process.exit(1);
}

const hadLegacy = await fs.exists(legacyItemsRoot(vaultPath));
const meta = await migrateVaultSchema(fs, vaultPath);

console.log(
  JSON.stringify(
    {
      vaultId: meta.id,
      schema_version: meta.schema_version,
      converted_legacy_items_dir: hadLegacy,
    },
    null,
    2,
  ),
);
