import { errorMessage } from "../../services/runtime-error";

/** Gates vault-triggered reloads while the detail page is leaving after delete. */
export type ItemDetailReloadGate = {
  markLeavingAfterDelete: () => void;
  clearLeavingAfterDelete: () => void;
  shouldStartReload: () => boolean;
  shouldReportLoadError: (cancelled: boolean) => boolean;
};

export function createItemDetailReloadGate(): ItemDetailReloadGate {
  let leavingAfterDelete = false;
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
