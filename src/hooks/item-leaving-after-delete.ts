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

/** Whether a footer link load failure should reach AlertStack. */
export function shouldReportFooterLinkError(options: {
  cancelled: boolean;
  leaving: boolean;
}): boolean {
  return !options.cancelled && !options.leaving;
}
