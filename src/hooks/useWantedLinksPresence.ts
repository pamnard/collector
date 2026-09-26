import { useEffect, useState } from "react";
import { getCollectorService } from "../services/collector-client";

/**
 * Whether the vault currently has any wanted / broken internal link targets.
 * Cheap probe: limit 1, only `total` matters.
 * Refetches on vaultRevision and optional refreshKey (e.g. route).
 */
export function useWantedLinksPresence(
  vaultRevision: number,
  refreshKey?: string | number,
): boolean {
  const [hasWantedLinks, setHasWantedLinks] = useState(false);

  useEffect(() => {
    let active = true;
    void getCollectorService()
      .items.queryWantedLinkTargets(
        { limit: 1, offset: 0 },
        { key: "source_count", dir: "desc" },
      )
      .then((result) => {
        if (!active) {
          return;
        }
        setHasWantedLinks(result.total > 0);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        // Keep prior value on transient failure — do not flash the dot off.
      });
    return () => {
      active = false;
    };
  }, [vaultRevision, refreshKey]);

  return hasWantedLinks;
}
