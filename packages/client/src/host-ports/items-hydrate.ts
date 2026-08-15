import {
  DASHBOARD_HYDRATE_CHUNK_SIZE,
  DASHBOARD_HYDRATE_MAX_IDS,
} from "@collector/api";
import type { ItemFile } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";

/**
 * Chunked dashboard item hydrate over `loadDashboardItems` (#666 / #715).
 * Lives outside the items port factory so the factory stays thin RPC wrappers.
 */
export async function* hydrateHostItems(
  transport: Pick<HostWireClient, "request">,
  ids: string[],
  options?: { signal?: AbortSignal },
): AsyncGenerator<ItemFile, void, undefined> {
  const signal = options?.signal;
  if (!ids.length || signal?.aborted) {
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
    if (signal?.aborted) {
      return;
    }
    const chunk = ids.slice(offset, offset + DASHBOARD_HYDRATE_CHUNK_SIZE);
    const items = (await transport.request("loadDashboardItems", {
      itemIds: chunk,
      offset: 0,
      limit: chunk.length,
    })) as ItemFile[];
    for (const item of items) {
      if (signal?.aborted) {
        return;
      }
      yield item;
    }
  }
}
