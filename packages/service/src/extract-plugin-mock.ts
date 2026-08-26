/**
 * In-memory mock ExtractorPlugin (#849) for contract / wire tests.
 *
 * Discover: when body or frontmatter URL contains the marker URL, emits one
 * candidate. Extract records the call (no network / vault writes).
 */

import type { ExtractCandidate, ExtractorPlugin } from "@collector/api";

export const MOCK_EXTRACTOR_ID = "mock";
export const MOCK_EXTRACT_MARKER_URL = "https://example.com/mock-extract";

export interface MockExtractorPluginOptions {
  id?: string;
  /** Substring matched in body or frontmatterUrl to emit a candidate. */
  markerUrl?: string;
}

export interface MockExtractorPlugin extends ExtractorPlugin {
  discoverCalls: Array<{ body: string; frontmatterUrl?: string | null }>;
  extractCalls: Array<{ itemId: string; candidate: ExtractCandidate }>;
}

export function createMockExtractorPlugin(
  options: MockExtractorPluginOptions = {},
): MockExtractorPlugin {
  const id = options.id ?? MOCK_EXTRACTOR_ID;
  const markerUrl = options.markerUrl ?? MOCK_EXTRACT_MARKER_URL;

  const plugin: MockExtractorPlugin = {
    id,
    discoverCalls: [],
    extractCalls: [],

    discover(input) {
      plugin.discoverCalls.push({
        body: input.body,
        frontmatterUrl: input.frontmatterUrl,
      });
      const fromBody = input.body.includes(markerUrl);
      const fromUrl =
        typeof input.frontmatterUrl === "string" &&
        input.frontmatterUrl.includes(markerUrl);
      if (!fromBody && !fromUrl) {
        return [];
      }
      const url = fromUrl ? (input.frontmatterUrl as string) : markerUrl;
      return [
        {
          extractorId: id,
          url,
          meta: { source: fromUrl ? "frontmatter" : "body" },
        },
      ];
    },

    async extract(input) {
      plugin.extractCalls.push({
        itemId: input.itemId,
        candidate: input.candidate,
      });
    },
  };

  return plugin;
}
