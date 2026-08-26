/**
 * Extract plugin registry (#849).
 *
 * In-process catalog only — separate from SyncPlugin. Default empty;
 * host extractors (e.g. Instagram #318) register via createCatalog.
 */

import type {
  ExtractCandidate,
  ExtractPort,
  ExtractorPlugin,
  GetItemResult,
} from "@collector/api";

export interface ExtractPluginRegistryDeps {
  getItemById: (itemId: string) => Promise<GetItemResult>;
  /**
   * Build-time catalog. Default empty — mock is tests-only via override.
   */
  createCatalog?: () => ExtractorPlugin[];
}

export function createExtractPluginRegistry(
  deps: ExtractPluginRegistryDeps,
): ExtractPort {
  const catalog = deps.createCatalog?.() ?? [];
  const byId = new Map(catalog.map((plugin) => [plugin.id, plugin]));

  return {
    async discoverExtractCandidates(
      itemId: string,
    ): Promise<ExtractCandidate[]> {
      const { item, content } = await deps.getItemById(itemId);
      const body = content ?? "";
      const frontmatterUrl = item.url;
      const out: ExtractCandidate[] = [];
      for (const plugin of catalog) {
        out.push(
          ...plugin.discover({
            body,
            frontmatterUrl,
          }),
        );
      }
      return out;
    },

    async extractItemCandidate(
      itemId: string,
      candidate: ExtractCandidate,
    ): Promise<void> {
      const plugin = byId.get(candidate.extractorId);
      if (!plugin) {
        throw new Error(`Unknown extractor: ${candidate.extractorId}`);
      }
      await plugin.extract({ itemId, candidate });
    },
  };
}
