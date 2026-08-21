/**
 * Vault shell presentation subscription + trailing batch coalesce (#756).
 */

import type {
  Subscription,
  VaultPresentationChangedPayload,
} from "@collector/api";
import { isVaultPresentationPayload } from "../lib/vault-presentation-affects.ts";

export type VaultPresentationIndex = {
  subscribeVaultPresentationChanged: (
    onUpdate: (payload: VaultPresentationChangedPayload) => void,
  ) => Subscription;
};

/**
 * Window for coalescing vaultRevision bumps (#653) and presentation batches (#756).
 */
export const VAULT_REVISION_BUMP_COALESCE_MS = 100;

/** Trailing batch window for incremental presentation events (#756). */
export const VAULT_PRESENTATION_BATCH_MS = 75;

/**
 * Leading-edge coalesce: first bump runs, further bumps inside windowMs are no-ops.
 * Used for explicit full refreshVault / folder topology wipe only.
 */
export function createCoalescedVaultRevisionBump(
  onBump: () => void,
  windowMs: number = VAULT_REVISION_BUMP_COALESCE_MS,
  now: () => number = () => Date.now(),
): () => void {
  let lastBumpAt = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - lastBumpAt < windowMs) {
      return;
    }
    lastBumpAt = t;
    onBump();
  };
}

export type VaultPresentationBatchPlan =
  | { type: "fullWipe" }
  | { type: "incremental"; events: VaultPresentationChangedPayload[] };

/**
 * folderChanged or unknown/broken payload → full wipe.
 * Otherwise keep the batch for scoped incremental apply.
 */
export function planVaultPresentationBatch(
  batch: Array<VaultPresentationChangedPayload | unknown>,
): VaultPresentationBatchPlan {
  const events: VaultPresentationChangedPayload[] = [];
  for (const entry of batch) {
    if (!isVaultPresentationPayload(entry)) {
      return { type: "fullWipe" };
    }
    if (entry.kind === "folderChanged") {
      return { type: "fullWipe" };
    }
    events.push(entry);
  }
  return { type: "incremental", events };
}

export type TrailingPresentationBatch = {
  push: (payload: VaultPresentationChangedPayload | unknown) => void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Trailing debounce: accumulate burst events, apply once after quiet window.
 */
export function createTrailingPresentationBatch(
  onFlush: (batch: Array<VaultPresentationChangedPayload | unknown>) => void,
  windowMs: number = VAULT_PRESENTATION_BATCH_MS,
  schedule: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms),
  cancelScheduled: (handle: ReturnType<typeof setTimeout>) => void = (handle) =>
    clearTimeout(handle),
): TrailingPresentationBatch {
  let pending: Array<VaultPresentationChangedPayload | unknown> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      cancelScheduled(timer);
      timer = null;
    }
    if (pending.length === 0) {
      return;
    }
    const batch = pending;
    pending = [];
    onFlush(batch);
  };

  return {
    push(payload) {
      pending.push(payload);
      if (timer !== null) {
        cancelScheduled(timer);
      }
      timer = schedule(() => {
        timer = null;
        flush();
      }, windowMs);
    },
    flush,
    cancel() {
      if (timer !== null) {
        cancelScheduled(timer);
        timer = null;
      }
      pending = [];
    },
  };
}

/**
 * Subscribe to vault presentation changes with full payload.
 * Isolated from React / CollectorService singleton for unit tests.
 */
export function subscribeVaultPresentationChanged(
  index: VaultPresentationIndex,
  onEvent: (payload: VaultPresentationChangedPayload) => void,
): () => void {
  return index.subscribeVaultPresentationChanged(onEvent).unsubscribe;
}
