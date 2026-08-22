import { errorMessage } from "../../services/runtime-error";

/** Gates vault-triggered reloads while the detail page is leaving after delete. */
export type ItemDetailReloadGate = {
  markLeavingAfterDelete: () => void;
  clearLeavingAfterDelete: () => void;
  shouldStartReload: () => boolean;
  shouldReportLoadError: (cancelled: boolean) => boolean;
  /** Suppress vault soft reload for this item while save reload runs (#769). */
  markSaveReloadInFlight: (itemId: string) => void;
  clearSaveReloadInFlight: (itemId: string) => void;
  shouldSuppressVaultSoftReload: (itemId: string) => boolean;
  /** Record derived-complete signal suppressed during save reload (#769). */
  noteSuppressedDerivedComplete: (itemId: string) => void;
  hasPendingDerivedCompleteReload: (itemId: string) => boolean;
  clearPendingDerivedCompleteReload: (itemId: string) => void;
};

export function createItemDetailReloadGate(): ItemDetailReloadGate {
  let leavingAfterDelete = false;
  let saveReloadItemId: string | null = null;
  let pendingDerivedCompleteItemId: string | null = null;

  return {
    markLeavingAfterDelete() {
      leavingAfterDelete = true;
    },
    clearLeavingAfterDelete() {
      leavingAfterDelete = false;
    },
    shouldStartReload() {
      return !leavingAfterDelete;
    },
    shouldReportLoadError(cancelled: boolean) {
      return !cancelled && !leavingAfterDelete;
    },
    markSaveReloadInFlight(itemId: string) {
      saveReloadItemId = itemId;
      pendingDerivedCompleteItemId = null;
    },
    clearSaveReloadInFlight(itemId: string) {
      if (saveReloadItemId === itemId) {
        saveReloadItemId = null;
      }
    },
    shouldSuppressVaultSoftReload(itemId: string) {
      return saveReloadItemId === itemId;
    },
    noteSuppressedDerivedComplete(itemId: string) {
      if (saveReloadItemId === itemId) {
        pendingDerivedCompleteItemId = itemId;
      }
    },
    hasPendingDerivedCompleteReload(itemId: string) {
      return pendingDerivedCompleteItemId === itemId;
    },
    clearPendingDerivedCompleteReload(itemId: string) {
      if (pendingDerivedCompleteItemId === itemId) {
        pendingDerivedCompleteItemId = null;
      }
    },
  };
}

/**
 * Runs a detail reload unless the page is leaving after delete.
 * Returns whether a reload was started. Late failures are ignored when
 * cancelled or when delete has begun leaving.
 */
export async function runItemDetailVaultReload(options: {
  gate: ItemDetailReloadGate;
  isCancelled: () => boolean;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}): Promise<boolean> {
  if (!options.gate.shouldStartReload()) {
    return false;
  }
  try {
    await options.reload();
  } catch (err: unknown) {
    if (!options.gate.shouldReportLoadError(options.isCancelled())) {
      return true;
    }
    options.onError(errorMessage(err));
  }
  return true;
}
