import { useEffect, useState } from "react";
import type { BacklinkSource } from "@collector/api";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import type { ItemChromeItemRef } from "../components/layout/item-chrome/types";
import { useShell } from "../components/layout/AppLayout";
import { filterOutItemId } from "../lib/dashboard-commit";
import { shouldReportFooterLinkError } from "./item-leaving-after-delete";
import { useItemPruneEffect } from "./useItemPruneEffect";
import { getCollectorService } from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";

const ITEM_BACKLINKS_ERROR_ID = "item-backlinks-error";

/**
 * Loads unique text-link backlinks for the item footer (#410).
 * `null` while loading; `[]` on empty or fail-closed error.
 */
export function useItemBacklinks(
  item: Pick<ItemChromeItemRef, "id"> | null,
  vaultRevision: number,
): BacklinkSource[] | null {
  const alerts = useAlerts();
  const {
    itemPruneSignal,
    itemLiveSignal,
    isItemLeavingAfterDelete,
  } = useShell();
  useDismissAlertsOnUnmount([ITEM_BACKLINKS_ERROR_ID]);
  const [backlinks, setBacklinks] = useState<BacklinkSource[] | null>(null);

  const itemId = item?.id ?? null;
  const matchedLiveSeq =
    itemId && itemLiveSignal?.itemId === itemId ? itemLiveSignal.seq : 0;

  useEffect(() => {
    if (itemId === null) {
      setBacklinks(null);
      return;
    }

    if (isItemLeavingAfterDelete(itemId)) {
      setBacklinks([]);
      return;
    }

    const controller = new AbortController();
    setBacklinks(null);
    alerts.dismiss(ITEM_BACKLINKS_ERROR_ID);

    void (async () => {
      try {
        const result =
          await getCollectorService().items.listItemBacklinks(itemId);
        if (controller.signal.aborted) {
          return;
        }
        setBacklinks(result);
      } catch (err: unknown) {
        if (
          !shouldReportFooterLinkError({
            cancelled: controller.signal.aborted,
            leaving: isItemLeavingAfterDelete(itemId),
          })
        ) {
          return;
        }
        const message = errorMessage(err);
        console.error("[useItemBacklinks] load failed", {
          itemId,
          message,
        });
        alerts.upsert(ITEM_BACKLINKS_ERROR_ID, {
          tone: "danger",
          message: `Не удалось загрузить обратные ссылки: ${message}`,
        });
        setBacklinks([]);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [alerts, itemId, vaultRevision, matchedLiveSeq, isItemLeavingAfterDelete]);

  useItemPruneEffect(itemPruneSignal, (prunedId) => {
    setBacklinks((previous) => {
      if (previous === null) {
        return null;
      }
      const next = filterOutItemId(previous, prunedId);
      return next.length === previous.length ? previous : next;
    });
  });

  return backlinks;
}
