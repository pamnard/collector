import { useEffect, useState } from "react";
import type { AdjacentItemsResult } from "@collector/api";
import { getCollectorService } from "../../../services/collector-client";
import type { ItemChromeDomain } from "./types";

export function useItemAdjacent(
  domain: ItemChromeDomain | null,
): AdjacentItemsResult | null {
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
  }, [itemId, mode]);

  return adjacent;
}
