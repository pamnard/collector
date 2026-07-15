import { describe, expect, it } from "vitest";
import {
  canTakeReconcileFastPath,
  parseStoredReconcileFingerprint,
  reconcileFingerprintsMatch,
} from "./reconcile-fingerprint.js";

describe("reconcile fingerprint", () => {
  it("matches stored and current fingerprints", () => {
    const fingerprint = { itemsDirMtimeMs: 100, itemCount: 3 };
    expect(reconcileFingerprintsMatch(fingerprint, fingerprint)).toBe(true);
    expect(
      reconcileFingerprintsMatch(fingerprint, {
        itemsDirMtimeMs: 101,
        itemCount: 3,
      }),
    ).toBe(false);
  });

  it("rejects fast path when index is empty but disk has items", () => {
    expect(
      canTakeReconcileFastPath({
        storedFingerprint: { itemsDirMtimeMs: 1, itemCount: 2 },
        currentFingerprint: { itemsDirMtimeMs: 1, itemCount: 2 },
        indexedItemCount: 0,
        diskItemCount: 2,
        indexedIds: new Set(),
        diskItemIds: new Set(["a", "b"]),
      }),
    ).toBe(false);
  });

  it("parses stored fingerprint JSON", () => {
    expect(
      parseStoredReconcileFingerprint(
        JSON.stringify({ itemsDirMtimeMs: 42, itemCount: 7 }),
      ),
    ).toEqual({ itemsDirMtimeMs: 42, itemCount: 7 });
    expect(parseStoredReconcileFingerprint(null)).toBeNull();
  });
});
