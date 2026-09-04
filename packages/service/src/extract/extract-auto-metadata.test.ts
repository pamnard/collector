import { describe, expect, it } from "vitest";
import type { ExtractCandidate } from "@collector/api";
import {
  extractAutoShortcode,
  filterUntriedExtractCandidates,
  mergeExtractAutoAttempt,
  parseExtractAutoMap,
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
  it("parses and merges extract_auto attempt maps", () => {
    const map = mergeExtractAutoAttempt(
      {},
      "AbC",
      { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
    );
    expect(parseExtractAutoMap(map)).toEqual({
      AbC: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
    });
    expect(parseExtractAutoMap(map).AbC).toBeDefined();
    expect(parseExtractAutoMap(map).other).toBeUndefined();

    const withFail = mergeExtractAutoAttempt(map, "XyZ", {
      attempted_at: "2026-01-02T00:00:00.000Z",
      ok: false,
      error: "boom",
    });
    expect(withFail).toMatchObject({
      AbC: { ok: true },
      XyZ: { ok: false, error: "boom" },
    });
  });

  it("filters untried shortcodes and skips candidates without shortcode", () => {
    const tried = mergeExtractAutoAttempt(
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
      tried,
    );
    expect(pending.map((c) => extractAutoShortcode(c))).toEqual(["Fresh"]);
  });

  it("parseExtractAutoMap ignores corrupt entries", () => {
    expect(parseExtractAutoMap(null)).toEqual({});
    expect(parseExtractAutoMap([])).toEqual({});
    expect(
      parseExtractAutoMap({
        ok: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
        bad: { attempted_at: 1, ok: true },
        also: "nope",
      }),
    ).toEqual({
      ok: { attempted_at: "2026-01-01T00:00:00.000Z", ok: true },
    });
  });
});
