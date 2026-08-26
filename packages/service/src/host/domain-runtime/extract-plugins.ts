/**
 * Extract plugin runtime (#849) — in-process registry on the domain host.
 * Default catalog empty; Instagram assembly registers in #318.
 */

import type { ExtractPort } from "@collector/api";
import type { createItemsSearchService } from "../../items-search.js";
import { createExtractPluginRegistry } from "../../extract-plugin-registry.js";

export interface ExtractPluginRuntimeDeps {
  itemsSearch: ReturnType<typeof createItemsSearchService>;
}

export function createExtractPluginRuntime(
  deps: ExtractPluginRuntimeDeps,
): ExtractPort {
  return createExtractPluginRegistry({
    getItemById: (itemId) => deps.itemsSearch.getItemById(itemId),
  });
}
