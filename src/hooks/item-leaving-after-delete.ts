import { isItemNotFoundMessage } from "../services/runtime-error";

/**
 * Sync flag: detail page is leaving after delete while vaultRevision may still
 * bump mid-await. Footer link hooks must not alert on Item not found.
 */
export type ItemLeavingAfterDelete = {
  markItemLeavingAfterDelete: (itemId: string) => void;
  clearItemLeavingAfterDelete: () => void;
  isItemLeavingAfterDelete: (itemId: string) => boolean;
};

export function createItemLeavingAfterDelete(): ItemLeavingAfterDelete {
  let leavingItemId: string | null = null;

  return {
    markItemLeavingAfterDelete(itemId: string) {
      leavingItemId = itemId;
    },
    clearItemLeavingAfterDelete() {
      leavingItemId = null;
    },
    isItemLeavingAfterDelete(itemId: string) {
      return leavingItemId === itemId;
    },
  };
}

/**
 * Whether a footer link load failure should reach AlertStack.
 * Like detail reload gate (`!cancelled && !leaving`), plus silent fail-closed
 * when the open item itself is already gone (`Item not found:`).
 */
export function shouldReportFooterLinkError(options: {
  cancelled: boolean;
  leaving: boolean;
  message: string;
}): boolean {
  return (
    !options.cancelled &&
    !options.leaving &&
    !isItemNotFoundMessage(options.message)
  );
}
