import {
  DASHBOARD_HYDRATE_CHUNK_SIZE,
  DASHBOARD_HYDRATE_MAX_IDS,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";

/**
 * Chunked dashboard hydrate over `loadDashboardItems` (#666 / #673 / #715).
 * Kept outside the items port factory so the factory stays thin request wrappers.
 */
export async function* hydrateHostItems(
  transport: HostWireClient,
  ids: string[],
  options?: { signal?: AbortSignal },
): AsyncIterable<ItemFile> {
  if (!ids.length || options?.signal?.aborted) {
    return;
  }
  if (ids.length > DASHBOARD_HYDRATE_MAX_IDS) {
    throw new Error(
      `hydrate: id list length ${ids.length} exceeds max ${DASHBOARD_HYDRATE_MAX_IDS}`,
    );
  }
  for (
    let offset = 0;
    offset < ids.length;
    offset += DASHBOARD_HYDRATE_CHUNK_SIZE
  ) {
    if (options?.signal?.aborted) {
      return;
    }
    const chunk = ids.slice(offset, offset + DASHBOARD_HYDRATE_CHUNK_SIZE);
    const items = (await transport.request("loadDashboardItems", {
      itemIds: chunk,
      offset: 0,
      limit: chunk.length,
    })) as ItemFile[];
    for (const item of items) {
      if (options?.signal?.aborted) {
        return;
      }
      yield item;
    }
  }
}
