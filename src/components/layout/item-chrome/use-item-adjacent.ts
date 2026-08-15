import { useEffect, useState } from "react";
import type { AdjacentItemsResult } from "@collector/api";
import { useItemPruneEffect } from "../../../hooks/useItemPruneEffect";
import { getCollectorService } from "../../../services/collector-client";
import { useShell } from "../AppLayout";
import type { ItemChromeDomain } from "./types";

export function useItemAdjacent(
  domain: ItemChromeDomain | null,
): AdjacentItemsResult | null {
  const { vaultRevision, itemPruneSignal } = useShell();
  const [adjacent, setAdjacent] = useState<AdjacentItemsResult | null>(null);
  const itemId = domain?.item?.id ?? null;
  const mode = domain?.mode ?? null;

  useEffect(() => {
    if (itemId === null || mode !== "view") {
      setAdjacent(null);
      return;
    }
    let cancelled = false;
    setAdjacent(null);
    void getCollectorService()
      .items.getAdjacentItems(itemId)
      .then((result) => {
        if (!cancelled) {
          setAdjacent(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAdjacent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, mode, vaultRevision]);

  useItemPruneEffect(itemPruneSignal, (prunedId) => {
    setAdjacent((previous) => {
      if (previous === null) {
        return null;
      }
      const prev = previous.prev?.id === prunedId ? null : previous.prev;
      const next = previous.next?.id === prunedId ? null : previous.next;
      if (prev === previous.prev && next === previous.next) {
        return previous;
      }
      return { prev, next };
    });
  });

  return adjacent;
}
