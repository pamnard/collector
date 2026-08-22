import { useEffect, useState } from "react";
import type { OutboundTextLink } from "@collector/api";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import type { ItemChromeItemRef } from "../components/layout/item-chrome/types";
import { useShell } from "../components/layout/AppLayout";
import { useItemPruneEffect } from "./useItemPruneEffect";
import { getCollectorService } from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";

const ITEM_OUTBOUND_ERROR_ID = "item-outbound-error";

/**
 * Loads outgoing text links for the item footer (#457).
 * `null` while loading; `[]` on empty or fail-closed error.
 */
export function useItemOutboundLinks(
  item: Pick<ItemChromeItemRef, "id"> | null,
  vaultRevision: number,
): OutboundTextLink[] | null {
  const alerts = useAlerts();
  const { itemPruneSignal, itemLiveSignal } = useShell();
  useDismissAlertsOnUnmount([ITEM_OUTBOUND_ERROR_ID]);
  const [outbound, setOutbound] = useState<OutboundTextLink[] | null>(null);

  const itemId = item?.id ?? null;
  const matchedLiveSeq =
    itemId && itemLiveSignal?.itemId === itemId ? itemLiveSignal.seq : 0;

  useEffect(() => {
    if (itemId === null) {
      setOutbound(null);
      return;
    }

    const controller = new AbortController();
    setOutbound(null);
    alerts.dismiss(ITEM_OUTBOUND_ERROR_ID);

    void (async () => {
      try {
        const result =
          await getCollectorService().items.listItemOutboundLinks(itemId);
        if (controller.signal.aborted) {
          return;
        }
        setOutbound(result);
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        const message = errorMessage(err);
        console.error("[useItemOutboundLinks] load failed", {
          itemId,
          message,
        });
        alerts.upsert(ITEM_OUTBOUND_ERROR_ID, {
          tone: "danger",
          message: `Не удалось загрузить исходящие ссылки: ${message}`,
        });
        setOutbound([]);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [alerts, itemId, vaultRevision, matchedLiveSeq]);

  useItemPruneEffect(itemPruneSignal, (prunedId) => {
    setOutbound((previous) => {
      if (previous === null) {
        return null;
      }
      const next = previous.filter((link) => link.resolvedItemId !== prunedId);
      return next.length === previous.length ? previous : next;
    });
  });

  return outbound;
}
