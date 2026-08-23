import { useEffect, useMemo, useState } from "react";
import type { TagWithCount } from "@collector/core";
import { getCollectorService } from "../../../services/collector-client";
import { useShell } from "../../layout/AppLayout";

/** Tags map for table badge cells; reloads on vault revision. */
export function useItemTableTags(): Map<string, TagWithCount> {
  const { vaultRevision } = useShell();
  const [tags, setTags] = useState<TagWithCount[]>([]);

  useEffect(() => {
    void getCollectorService().tags.listTags().then(setTags);
  }, [vaultRevision]);

  return useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
}
