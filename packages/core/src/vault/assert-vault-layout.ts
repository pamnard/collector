import type { FileSystemAdapter } from "../adapters/types.js";
import { legacyItemsRoot } from "./paths.js";

/**
 * Current vault layout is a document tree at vault root (path-as-id `.md`).
 * Legacy `items/<uuid>/` is never converted by the app — use
 * `scripts/migrate-vault-layout.mjs` once if needed.
 */
export async function assertVaultTreeLayout(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<void> {
  const legacyRoot = legacyItemsRoot(vaultPath);
  if (!(await fs.exists(legacyRoot))) {
    return;
  }
  throw new Error(
    "Vault still uses legacy items/<uuid>/ layout. " +
      "Run once: node scripts/migrate-vault-layout.mjs <vault-path>",
  );
}
