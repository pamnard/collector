import { useEffect, useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import type { ItemChromeItemRef } from "../components/layout/item-chrome/types";
import { useShell } from "../components/layout/AppLayout";
import { filterOutItemId } from "../lib/dashboard-commit";
import {
  shouldReportFooterLinkError,
} from "./item-leaving-after-delete";
import { useItemPruneEffect } from "./useItemPruneEffect";
import { loadRelatedSemanticTeasers } from "../lib/related-semantic-items";
import type { RelatedTeaser } from "../lib/related-teaser";
import { probeCoverImageFormInBrowser } from "../lib/teaser-layout/probe-cover-image-form";
import {
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";

const RELATED_SEMANTIC_ERROR_ID = "item-related-semantic-error";

/**
 * Loads semantic related teasers for the item detail panel (#414).
 * Fail closed: errors and empty/shortfall → `teasers: null`.
 * `ready` is false while a load for the current item is in flight.
 * Covers: same `UiSession.thumbnails` batch as collection cards.
 */
export function useRelatedSemanticTeasers(
  item: Pick<ItemChromeItemRef, "id"> | null,
  vaultRevision: number,
): { teasers: RelatedTeaser[] | null; ready: boolean } {
  const alerts = useAlerts();
  const {
    itemPruneSignal,
    itemLiveSignal,
    isItemLeavingAfterDelete,
  } = useShell();
  useDismissAlertsOnUnmount([RELATED_SEMANTIC_ERROR_ID]);
  const [teasers, setTeasers] = useState<RelatedTeaser[] | null>(null);
  const [ready, setReady] = useState(false);

  const itemId = item?.id ?? null;
  const matchedLiveSeq =
    itemId && itemLiveSignal?.itemId === itemId ? itemLiveSignal.seq : 0;

  useEffect(() => {
    if (itemId === null) {
      setTeasers(null);
      setReady(false);
      return;
    }

    if (isItemLeavingAfterDelete(itemId)) {
      setTeasers(null);
      setReady(true);
      return;
    }

    const controller = new AbortController();
    setTeasers(null);
    setReady(false);
    alerts.dismiss(RELATED_SEMANTIC_ERROR_ID);

    void (async () => {
      try {
        const service = getCollectorService();
        const result = await loadRelatedSemanticTeasers({
          currentItemId: itemId,
          signal: controller.signal,
          findSimilarItems: (id, limit) =>
            service.items.findSimilarItems(id, limit),
          hydrate: (ids, options) =>
            service.items.hydrate(ids, { signal: options?.signal }),
          resolveThumbnailPaths: (items) =>
            getUiSession().thumbnails.resolveItemThumbnailPaths(items),
          probeCoverImageForm: probeCoverImageFormInBrowser,
        });
        if (controller.signal.aborted) {
          return;
        }
        setTeasers(result);
        setReady(true);
      } catch (err: unknown) {
        const message = errorMessage(err);
        if (
          !shouldReportFooterLinkError({
            cancelled: controller.signal.aborted,
            leaving: isItemLeavingAfterDelete(itemId),
            message,
          })
        ) {
          if (!controller.signal.aborted) {
            setTeasers(null);
            setReady(true);
          }
          return;
        }
        console.error("[useRelatedSemanticTeasers] load failed", {
          itemId,
          message,
        });
        alerts.upsert(RELATED_SEMANTIC_ERROR_ID, {
          tone: "danger",
          message: `Не удалось загрузить релевантные: ${message}`,
        });
        setTeasers(null);
        setReady(true);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [alerts, itemId, vaultRevision, matchedLiveSeq, isItemLeavingAfterDelete]);

  useItemPruneEffect(itemPruneSignal, (prunedId) => {
    if (itemId !== null && prunedId === itemId) {
      alerts.dismiss(RELATED_SEMANTIC_ERROR_ID);
      setTeasers(null);
      setReady(true);
      return;
    }
    setTeasers((previous) => {
      if (previous === null) {
        return null;
      }
      const next = filterOutItemId(previous, prunedId);
      if (next.length === previous.length) {
        return previous;
      }
      return next.length === 0 ? null : next;
    });
  });

  return { teasers, ready };
}
