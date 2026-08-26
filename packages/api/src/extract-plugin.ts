/**
 * Extract plugin contract (#849) — host discover → explicit extract.
 * Host-specific fetch/merge stay in per-host extractors (e.g. Instagram #318).
 * Not SyncPlugin; not html/readability (#316).
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
