import type { ExtractCandidate } from "../extract-plugin.js";

/**
 * Discover → extract host surface (#849).
 * Separate from {@link SyncPluginsPort}; host fetch/merge live in extractor plugins.
 */
export interface ExtractPort {
  discoverExtractCandidates(itemId: string): Promise<ExtractCandidate[]>;
  extractItemCandidate(
    itemId: string,
    candidate: ExtractCandidate,
  ): Promise<void>;
}
