import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MediaWithPath } from "@collector/core";
import { partitionMediaFiles } from "./partition-media-files.ts";

function media(
  id: string,
  media_type: MediaWithPath["media_type"],
): MediaWithPath {
  return {
    id,
    item_id: "item",
    filename: `${id}.bin`,
    media_type,
    absolute_path: `/tmp/${id}`,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("partitionMediaFiles", () => {
  it("keeps image|video in encounter order; non-visual go to list", () => {
    const files = [
      media("i1", "image"),
      media("v1", "video"),
      media("a1", "audio"),
      media("i2", "image"),
      media("o1", "other"),
    ];
    const { visualFiles, listFiles } = partitionMediaFiles(files);
    assert.deepEqual(
      visualFiles.map((f) => f.id),
      ["i1", "v1", "i2"],
    );
    assert.deepEqual(
      listFiles.map((f) => f.id),
      ["a1", "o1"],
    );
  });

  it("returns empty partitions for empty input", () => {
    assert.deepEqual(partitionMediaFiles([]), {
      visualFiles: [],
      listFiles: [],
    });
  });
});
