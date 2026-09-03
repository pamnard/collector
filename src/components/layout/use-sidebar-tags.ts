import { useEffect, useState } from "react";
import type { TagWithCount } from "@collector/core";
import { getCollectorService } from "../../services/collector-client";
import { useAlerts } from "../alerts/AlertBusProvider";
import { errorMessage } from "../alerts/alert-store";
import { subscribeTagListLive } from "../../lib/tag-list-live";

const TAG_LIST_REFRESH_ERROR_ID = "tag-list-refresh-error";

/** Live tag list for the sidebar tags panel (abort on vaultRevision / unmount). */
export function useSidebarTags(vaultRevision: number): TagWithCount[] {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const alerts = useAlerts();

  useEffect(() => {
    const controller = new AbortController();
    getCollectorService().tags.subscribeTags(
      setTags,
      undefined,
      controller.signal,
    );
    return () => {
      controller.abort();
    };
  }, [vaultRevision]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeTagListLive(() => {
      void getCollectorService()
        .tags.listTags()
        .then((next) => {
          if (!active) {
            return;
          }
          alerts.dismiss(TAG_LIST_REFRESH_ERROR_ID);
          setTags(next);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          alerts.upsert(TAG_LIST_REFRESH_ERROR_ID, {
            tone: "danger",
            message: errorMessage(error),
          });
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [alerts]);

  return tags;
}
