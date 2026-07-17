import type { FileSystemAdapter } from "../adapters/types.js";

export interface ReconcileFingerprint {
  /** Vault root directory mtime (bumped on every item write via touch). */
  itemsDirMtimeMs: number;
  /** Count of markdown items on disk. */
  itemCount: number;
}

/**
 * Cheap fingerprint from the vault root mtime + on-disk item count. The item
 * count is supplied by the caller (already computed from a directory scan) to
 * avoid a second walk; only the vault root is `stat`ed here.
 */
export async function readVaultReconcileFingerprint(
  fs: FileSystemAdapter,
  vaultRootPath: string,
  itemCount: number,
): Promise<ReconcileFingerprint> {
  const rootStat = await fs.stat(vaultRootPath);
  if (rootStat.mtimeMs === null) {
    throw new Error(`vault root mtime unavailable: ${vaultRootPath}`);
  }
  return {
    itemsDirMtimeMs: rootStat.mtimeMs,
    itemCount,
  };
}

export function reconcileFingerprintsMatch(
  a: ReconcileFingerprint,
  b: ReconcileFingerprint,
): boolean {
  return a.itemsDirMtimeMs === b.itemsDirMtimeMs && a.itemCount === b.itemCount;
}

export function serializeReconcileFingerprint(fingerprint: ReconcileFingerprint): string {
  return JSON.stringify(fingerprint);
}

export function parseStoredReconcileFingerprint(
  raw: string | null | undefined,
): ReconcileFingerprint | null {
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as Partial<ReconcileFingerprint>;
  if (
    typeof parsed.itemsDirMtimeMs !== "number" ||
    typeof parsed.itemCount !== "number"
  ) {
    return null;
  }
  return { itemsDirMtimeMs: parsed.itemsDirMtimeMs, itemCount: parsed.itemCount };
}

/**
 * Fast path: skip the per-item stat/read pass entirely when the vault root
 * mtime + on-disk item count exactly match what was indexed last time, and
 * the indexed id count agrees with the disk id count (belt-and-suspenders
 * against silent index/disk drift).
 */
export function canTakeReconcileFastPath(input: {
  storedFingerprint: ReconcileFingerprint | null;
  currentFingerprint: ReconcileFingerprint;
  indexedItemCount: number;
  diskItemCount: number;
  indexedIds: Set<string>;
  diskItemIds: Set<string>;
}): boolean {
  if (!input.storedFingerprint) {
    return false;
  }
  if (!reconcileFingerprintsMatch(input.storedFingerprint, input.currentFingerprint)) {
    return false;
  }
  if (input.indexedItemCount !== input.diskItemCount) {
    return false;
  }
  if (input.indexedIds.size !== input.diskItemIds.size) {
    return false;
  }
  for (const id of input.diskItemIds) {
    if (!input.indexedIds.has(id)) {
      return false;
    }
  }
  return true;
}
