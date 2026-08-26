import { describe, expect, it } from "vitest";
import { CliUsageError } from "../types.js";
import {
  parseDiscoverExtractCandidates,
  parseExtractItemCandidate,
} from "./extract.js";

describe("extract CLI parse (#849)", () => {
  it("parses discover-extract-candidates", () => {
    expect(parseDiscoverExtractCandidates([], ["Inbox/note.md"])).toEqual({
      name: "discover-extract-candidates",
      itemId: "Inbox/note.md",
    });
  });

  it("parses extract-item-candidate with meta JSON", () => {
    expect(
      parseExtractItemCandidate(
        [
          "--extractor-id",
          "mock",
          "--url",
          "https://example.com/mock-extract",
          "--meta",
          '{"source":"body"}',
        ],
        ["Inbox/note.md"],
      ),
    ).toEqual({
      name: "extract-item-candidate",
      itemId: "Inbox/note.md",
      extractorId: "mock",
      url: "https://example.com/mock-extract",
      meta: { source: "body" },
    });
  });

  it("rejects extract-item-candidate without required flags", () => {
    expect(() => parseExtractItemCandidate([], ["Inbox/note.md"])).toThrow(
      CliUsageError,
    );
  });

  it("rejects invalid --meta JSON", () => {
    expect(() =>
      parseExtractItemCandidate(
        [
          "--extractor-id",
          "mock",
          "--url",
          "https://example.com/x",
          "--meta",
          "not-json",
        ],
        ["Inbox/note.md"],
      ),
    ).toThrow(/JSON object/);
  });
});
