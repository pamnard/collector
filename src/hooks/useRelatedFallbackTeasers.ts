import { useEffect, useState } from "react";
import {
  useAlerts,
  useDismissAlertsOnUnmount,
} from "../components/alerts/AlertBusProvider";
import type { ItemChromeItemRef } from "../components/layout/item-chrome/types";
import { loadRelatedFallbackTeasers } from "../lib/related-fallback-items";
import type { RelatedTeaser } from "../lib/related-teaser";
import { probeCoverImageFormInBrowser } from "../lib/teaser-layout/probe-cover-image-form";
import {
  getCollectorService,
  getUiSession,
} from "../services/collector-client";
import { errorMessage } from "../services/runtime-error";

const RELATED_FALLBACK_ERROR_ID = "item-related-fallback-error";

/**
 * Loads related teasers for the item detail panel (#603).
 * Fail closed: errors and shortfall → `null` (panel hidden).
 * Covers: same `UiSession.thumbnails` batch as collection cards.
 */
export function useRelatedFallbackTeasers(
  item: Pick<ItemChromeItemRef, "id" | "folder_path"> | null,
): RelatedTeaser[] | null {
  const alerts = useAlerts();
  useDismissAlertsOnUnmount([RELATED_FALLBACK_ERROR_ID]);
  const [teasers, setTeasers] = useState<RelatedTeaser[] | null>(null);

  const itemId = item?.id ?? null;
  const folderPath = item?.folder_path;

  useEffect(() => {
    if (itemId === null || folderPath === undefined) {
      setTeasers(null);
      return;
    }

    const controller = new AbortController();
    setTeasers(null);
    alerts.dismiss(RELATED_FALLBACK_ERROR_ID);

    void (async () => {
      try {
        const service = getCollectorService();
        const result = await loadRelatedFallbackTeasers({
          currentItemId: itemId,
          startFolderPath: folderPath,
          signal: controller.signal,
          queryFolderIds: async ({ folderPath: path, limit }) => {
            const page = await service.items.queryIndex(
              { type: "folder", folderPath: path },
              "",
              { limit, offset: 0 },
              { key: "created_at", dir: "desc" },
            );
            return page.ids;
          },
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
        console.error("[useRelatedFallbackTeasers] load failed", {
          itemId,
          message,
        });
        alerts.upsert(RELATED_FALLBACK_ERROR_ID, {
          tone: "error",
          message: `Не удалось загрузить релевантные: ${message}`,
        });
        setTeasers(null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [alerts, folderPath, itemId]);

  return teasers;
}
