import { describe, expect, it } from "vitest";
import type { ExtractCandidate } from "@collector/api";
import {
  EXTRACT_AUTO_METADATA_KEY,
  extractAutoShortcode,
  filterUntriedExtractCandidates,
  mergeExtractAutoAttempt,
  readExtractAutoMap,
} from "./extract-auto-metadata.js";

function candidate(
  shortcode: string,
  url = `https://www.instagram.com/p/${shortcode}/`,
): ExtractCandidate {
  return {
    extractorId: "instagram",
    url,
    meta: { shortcode },
  };
}

describe("extract-auto-metadata", () => {
  it("reads and merges extract_auto map", () => {
    const metadata = mergeExtractAutoAttempt(
      {},
      "AbC",
      { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
    );
    expect(readExtractAutoMap(metadata)).toEqual({
      AbC: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
    });
    expect(readExtractAutoMap(metadata).AbC).toBeDefined();
    expect(readExtractAutoMap(metadata).other).toBeUndefined();

    const withFail = mergeExtractAutoAttempt(metadata, "XyZ", {
      attempted_at: "2026-01-02T00:00:00.000Z",
      ok: false,
      error: "boom",
    });
    expect(withFail[EXTRACT_AUTO_METADATA_KEY]).toMatchObject({
      AbC: { ok: true },
      XyZ: { ok: false, error: "boom" },
    });
  });

  it("filters untried shortcodes and skips candidates without shortcode", () => {
    const metadata = mergeExtractAutoAttempt(
      {},
      "Tried",
      { attempted_at: "2026-01-01T00:00:00.000Z", ok: false, error: "x" },
    );
    const pending = filterUntriedExtractCandidates(
      [
        candidate("Tried"),
        candidate("Fresh"),
        { extractorId: "instagram", url: "https://example.com/x" },
      ],
      metadata,
    );
    expect(pending.map((c) => extractAutoShortcode(c))).toEqual(["Fresh"]);
  });
});
