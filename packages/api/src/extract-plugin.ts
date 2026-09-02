/**
 * Extract plugin contract (#849) — discover matching site links, then extract on demand.
 * Per-site fetch/merge lives in site extractors (e.g. Instagram #318).
 * Not a generic “download any web page into a note” path (that is agent fetch + updateItem; see #316).
 * MCP/CLI wording must stay plain: empty discover = not a supported site; import the page yourself.
 */

export type ExtractCandidate = {
  extractorId: string;
  url: string;
  /** Opaque per-extractor fields allowed (e.g. shortcode). */
  meta?: Record<string, string>;
};

/** Plugin owned by host extractors; register in a small in-process registry. */
export type ExtractorPlugin = {
  readonly id: string;
  discover(input: {
    body: string;
    frontmatterUrl?: string | null;
  }): ExtractCandidate[];
  /** Explicit action only — never called on note open by this surface. */
  extract(input: {
    itemId: string;
    candidate: ExtractCandidate;
  }): Promise<void>;
};
