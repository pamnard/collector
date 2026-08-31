import { useCallback, useEffect, useRef, useState } from "react";
import type { VaultPresentationChangedPayload } from "@collector/api";
import {
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import { invalidateItemPresentationCache } from "../services/item-presentation-cache";
import {
  folderCountPatchPlanForEvent,
  mergeFolderCountDeltas,
  itemLiveSignalTriggerForEvent,
  sidebarSearchAffectedByEvent,
} from "../lib/vault-presentation-affects";
import {
  emitFolderTreeCountDeltas,
  emitFolderTreeRecount,
} from "../lib/folder-tree-live";
import {
  createItemLeavingAfterDelete,
  type ItemLeavingAfterDelete,
} from "./item-leaving-after-delete";
import {
  nextItemPruneSignal,
  type ItemPruneSignal,
} from "./useItemPruneEffect";
import {
  createCoalescedVaultRevisionBump,
  createTrailingPresentationBatch,
  planVaultPresentationBatch,
  subscribeVaultPresentationChanged,
} from "./vault-shell";

export type DashboardLiveHandler = (
  events: VaultPresentationChangedPayload[],
) => void;

export type ItemLiveSignal = {
  itemId: string;
  seq: number;
  trigger: "presentation" | "derivedComplete";
};

export type UseVaultShellResult = {
  vaultRevision: number;
  bumpVaultRevision: () => void;
  itemPruneSignal: ItemPruneSignal | null;
  itemLiveSignal: ItemLiveSignal | null;
  sidebarSearchLiveSeq: number;
  /** Keep the dashboard prune target current without recreating pruneItem. */
  setDashboardPrune: (prune: (itemId: string) => void) => void;
  setDashboardLiveHandler: (handler: DashboardLiveHandler) => void;
  pruneItem: (itemId: string) => void;
  markItemLeavingAfterDelete: ItemLeavingAfterDelete["markItemLeavingAfterDelete"];
  clearItemLeavingAfterDelete: ItemLeavingAfterDelete["clearItemLeavingAfterDelete"];
  isItemLeavingAfterDelete: ItemLeavingAfterDelete["isItemLeavingAfterDelete"];
};

export function useVaultShell(): UseVaultShellResult {
  const [vaultRevision, setVaultRevision] = useState(0);
  const [itemPruneSignal, setItemPruneSignal] =
    useState<ItemPruneSignal | null>(null);
  const [itemLiveSignal, setItemLiveSignal] = useState<ItemLiveSignal | null>(
    null,
  );
  const [sidebarSearchLiveSeq, setSidebarSearchLiveSeq] = useState(0);
  const dashboardPruneRef = useRef<(itemId: string) => void>(() => {
    throw new Error("useVaultShell: dashboard prune was not set");
  });
  const dashboardLiveRef = useRef<DashboardLiveHandler>(() => {});
  const itemLeavingAfterDelete = useRef(createItemLeavingAfterDelete()).current;

  // Explicit full refresh / folder topology / unknown payload (#756).
  const bumpVaultRevision = useRef(
    createCoalescedVaultRevisionBump(() => {
      invalidateItemPresentationCache();
      void getUiSession().snapshot.clearDashboardSnapshot();
      setVaultRevision((value) => value + 1);
    }),
  ).current;

  const applyIncremental = useCallback(
    (events: VaultPresentationChangedPayload[]) => {
      dashboardLiveRef.current(events);

      const deltas = new Map<string, number>();
      let needRecount = false;
      for (const event of events) {
        const plan = folderCountPatchPlanForEvent(event);
        if (plan.type === "reload" || plan.type === "recount") {
          needRecount = true;
        } else if (plan.type === "deltas") {
          mergeFolderCountDeltas(deltas, plan.deltas);
        }

        if (event.itemId) {
          const itemId = event.itemId;
          setItemLiveSignal((previous) => ({
            itemId,
            seq: (previous?.seq ?? 0) + 1,
            trigger: itemLiveSignalTriggerForEvent(event),
          }));
        }

        // Panel ignores the seq bump when its query is empty.
        if (sidebarSearchAffectedByEvent("x", event)) {
          setSidebarSearchLiveSeq((value) => value + 1);
        }
      }

      if (deltas.size > 0) {
        emitFolderTreeCountDeltas(deltas);
      }
      if (needRecount) {
        emitFolderTreeRecount();
      }
    },
    [],
  );

  useEffect(() => {
    const service = getCollectorService();
    const batch = createTrailingPresentationBatch((entries) => {
      const plan = planVaultPresentationBatch(entries);
      if (plan.type === "fullWipe") {
        bumpVaultRevision();
        return;
      }
      applyIncremental(plan.events);
    });
    const unsubscribe = subscribeVaultPresentationChanged(
      service.index,
      (payload) => {
        batch.push(payload);
      },
    );
    return () => {
      batch.cancel();
      unsubscribe();
    };
  }, [applyIncremental, bumpVaultRevision]);

  const setDashboardPrune = useCallback((prune: (itemId: string) => void) => {
    dashboardPruneRef.current = prune;
  }, []);

  const setDashboardLiveHandler = useCallback((handler: DashboardLiveHandler) => {
    dashboardLiveRef.current = handler;
  }, []);

  const pruneItem = useCallback((itemId: string) => {
    dashboardPruneRef.current(itemId);
    setItemPruneSignal((previous) => nextItemPruneSignal(previous, itemId));
  }, []);

  return {
    vaultRevision,
    bumpVaultRevision,
    itemPruneSignal,
    itemLiveSignal,
    sidebarSearchLiveSeq,
    setDashboardPrune,
    setDashboardLiveHandler,
    pruneItem,
    markItemLeavingAfterDelete: itemLeavingAfterDelete.markItemLeavingAfterDelete,
    clearItemLeavingAfterDelete:
      itemLeavingAfterDelete.clearItemLeavingAfterDelete,
    isItemLeavingAfterDelete: itemLeavingAfterDelete.isItemLeavingAfterDelete,
  };
}
