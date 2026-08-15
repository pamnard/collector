import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import { invalidateItemPresentationCache } from "../services/item-presentation-cache";
import {
  nextItemPruneSignal,
  type ItemPruneSignal,
} from "./useItemPruneEffect";
import { subscribeVaultPresentationRevision } from "./vault-shell";

export type UseVaultShellResult = {
  vaultRevision: number;
  bumpVaultRevision: () => void;
  itemPruneSignal: ItemPruneSignal | null;
  /** Keep the dashboard prune target current without recreating pruneItem. */
  setDashboardPrune: (prune: (itemId: string) => void) => void;
  pruneItem: (itemId: string) => void;
};

export function useVaultShell(): UseVaultShellResult {
  const [vaultRevision, setVaultRevision] = useState(0);
  const [itemPruneSignal, setItemPruneSignal] =
    useState<ItemPruneSignal | null>(null);
  const dashboardPruneRef = useRef<(itemId: string) => void>(() => {
    throw new Error("useVaultShell: dashboard prune was not set");
  });

  const bumpVaultRevision = useCallback(() => {
    invalidateItemPresentationCache();
    void getUiSession().snapshot.clearDashboardSnapshot();
    setVaultRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const service = getCollectorService();
    return subscribeVaultPresentationRevision(service.index, bumpVaultRevision);
  }, [bumpVaultRevision]);

  const setDashboardPrune = useCallback((prune: (itemId: string) => void) => {
    dashboardPruneRef.current = prune;
  }, []);

  const pruneItem = useCallback((itemId: string) => {
    dashboardPruneRef.current(itemId);
    setItemPruneSignal((previous) => nextItemPruneSignal(previous, itemId));
  }, []);

  return {
    vaultRevision,
    bumpVaultRevision,
    itemPruneSignal,
    setDashboardPrune,
    pruneItem,
  };
}
