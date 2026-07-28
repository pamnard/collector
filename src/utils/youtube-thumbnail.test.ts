import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getYouTubeThumbnail } from "./youtube-thumbnail.ts";

describe("getYouTubeThumbnail", () => {
  it("resolves watch, short, and youtu.be URLs", () => {
    assert.equal(
      getYouTubeThumbnail("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
    assert.equal(
      getYouTubeThumbnail("https://youtu.be/dQw4w9WgXcQ"),
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
    assert.equal(
      getYouTubeThumbnail("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    );
  });

  it("does not treat Reddit (or other) URLs with a path substring v/ as YouTube", () => {
    assert.equal(
      getYouTubeThumbnail(
        "https://www.reddit.com/r/aigamedev/comments/1s76q5f/finally_figured_out_how_to_make_decent_animations/",
      ),
      null,
    );
    assert.equal(
      getYouTubeThumbnail(
        "https://www.reddit.com/r/aigamedev/comments/1rf8t2x/released_a_super_early_testing_build_of_my_hex/",
      ),
      null,
    );
  });

  it("returns null for unrelated hosts and garbage", () => {
    assert.equal(getYouTubeThumbnail("https://example.com/watch?v=abc"), null);
    assert.equal(getYouTubeThumbnail("not-a-url"), null);
  });
});
