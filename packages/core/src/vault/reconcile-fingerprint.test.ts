import { describe, expect, it } from "vitest";
import {
  canTakeReconcileFastPath,
  parseStoredReconcileFingerprint,
  reconcileFingerprintsMatch,
  serializeReconcileFingerprint,
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
        diskItemIds: new Set(["a.md", "b.md"]),
      }),
    ).toBe(false);
  });

  it("accepts fast path when fingerprints and id sets fully agree", () => {
    expect(
      canTakeReconcileFastPath({
        storedFingerprint: { itemsDirMtimeMs: 1, itemCount: 2 },
        currentFingerprint: { itemsDirMtimeMs: 1, itemCount: 2 },
        indexedItemCount: 2,
        diskItemCount: 2,
        indexedIds: new Set(["a.md", "b.md"]),
        diskItemIds: new Set(["a.md", "b.md"]),
      }),
    ).toBe(true);
  });

  it("rejects fast path when there is no stored fingerprint", () => {
    expect(
      canTakeReconcileFastPath({
        storedFingerprint: null,
        currentFingerprint: { itemsDirMtimeMs: 1, itemCount: 0 },
        indexedItemCount: 0,
        diskItemCount: 0,
        indexedIds: new Set(),
        diskItemIds: new Set(),
      }),
    ).toBe(false);
  });

  it("round-trips serialize/parse", () => {
    const fingerprint = { itemsDirMtimeMs: 42, itemCount: 7 };
    expect(
      parseStoredReconcileFingerprint(serializeReconcileFingerprint(fingerprint)),
    ).toEqual(fingerprint);
    expect(parseStoredReconcileFingerprint(null)).toBeNull();
  });
});
