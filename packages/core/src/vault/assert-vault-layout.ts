import type { FileSystemAdapter } from "../adapters/types.js";
import { legacyItemsRoot } from "./paths.js";

/**
 * Soft check for leftover legacy `items/<uuid>/` trees.
 * Does not throw — open continues; operator migration is #281.
 * Returns true when the legacy root is present.
 */
export async function vaultHasLegacyItemsLayout(
  fs: FileSystemAdapter,
  vaultPath: string,
): Promise<boolean> {
  return fs.exists(legacyItemsRoot(vaultPath));
}
