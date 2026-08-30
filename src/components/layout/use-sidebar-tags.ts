import { useEffect, useState } from "react";
import type { TagWithCount } from "@collector/core";
import { getCollectorService } from "../../services/collector-client";

/** Live tag list for the sidebar tags panel (abort on vaultRevision / unmount). */
export function useSidebarTags(vaultRevision: number): TagWithCount[] {
  const [tags, setTags] = useState<TagWithCount[]>([]);

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

  return tags;
}
