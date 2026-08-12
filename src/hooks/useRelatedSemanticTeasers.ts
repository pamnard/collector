import { useEffect, useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import type { ItemChromeItemRef } from "../components/layout/item-chrome/types";
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
 * Fail closed: errors and empty/shortfall → `null` (panel hidden).
 * Covers: same `UiSession.thumbnails` batch as collection cards.
 */
export function useRelatedSemanticTeasers(
  item: Pick<ItemChromeItemRef, "id"> | null,
): RelatedTeaser[] | null {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([RELATED_SEMANTIC_ERROR_ID]);
  const [teasers, setTeasers] = useState<RelatedTeaser[] | null>(null);

  const itemId = item?.id ?? null;

  useEffect(() => {
    if (itemId === null) {
      setTeasers(null);
      return;
    }

    const controller = new AbortController();
    setTeasers(null);
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
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          return;
        }
        const message = errorMessage(err);
        console.error("[useRelatedSemanticTeasers] load failed", {
          itemId,
          message,
        });
        alerts.upsert(RELATED_SEMANTIC_ERROR_ID, {
          tone: "danger",
          message: `Не удалось загрузить релевантные: ${message}`,
        });
        setTeasers(null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [alerts, itemId]);

  return teasers;
}
