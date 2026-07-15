import type { FileSystemAdapter } from "../adapters/types.js";
import { filterDiskItemIds } from "./paths.js";

export interface ReconcileFingerprint {
  itemsDirMtimeMs: number;
  itemCount: number;
}

export async function readVaultReconcileFingerprint(
  fs: FileSystemAdapter,
  itemsDir: string,
): Promise<ReconcileFingerprint> {
  const diskItemIds = filterDiskItemIds(await fs.readDir(itemsDir));
  const itemsDirStat = await fs.stat(itemsDir);
  if (itemsDirStat.mtimeMs === null) {
    throw new Error(`items directory mtime unavailable: ${itemsDir}`);
  }
  return {
    itemsDirMtimeMs: itemsDirStat.mtimeMs,
    itemCount: diskItemIds.length,
  };
}

export function reconcileFingerprintsMatch(
  stored: ReconcileFingerprint | null,
  current: ReconcileFingerprint,
): boolean {
  if (!stored) {
    return false;
  }
  return (
    stored.itemsDirMtimeMs === current.itemsDirMtimeMs &&
    stored.itemCount === current.itemCount
  );
}

export function canTakeReconcileFastPath(input: {
  storedFingerprint: ReconcileFingerprint | null;
  currentFingerprint: ReconcileFingerprint;
  indexedItemCount: number;
  diskItemCount: number;
  indexedIds: Set<string>;
  diskItemIds: Set<string>;
}): boolean {
  if (input.indexedItemCount !== input.diskItemCount) {
    return false;
  }
  if (input.diskItemCount > 0 && input.indexedItemCount === 0) {
    return false;
  }
  if (
    !reconcileFingerprintsMatch(input.storedFingerprint, input.currentFingerprint)
  ) {
    return false;
  }
  if (input.indexedIds.size !== input.diskItemIds.size) {
    return false;
  }
  for (const id of input.indexedIds) {
    if (!input.diskItemIds.has(id)) {
      return false;
    }
  }
  return true;
}

export function parseStoredReconcileFingerprint(
  raw: string | null,
): ReconcileFingerprint | null {
  if (raw === null || raw === "") {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid reconcile fingerprint JSON");
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.itemsDirMtimeMs !== "number" ||
    typeof record.itemCount !== "number"
  ) {
    throw new Error("invalid reconcile fingerprint shape");
  }
  return {
    itemsDirMtimeMs: record.itemsDirMtimeMs,
    itemCount: record.itemCount,
  };
}

export function serializeReconcileFingerprint(
  fingerprint: ReconcileFingerprint,
): string {
  return JSON.stringify(fingerprint);
}
