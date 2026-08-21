import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseYouTubeVideoId, isYouTubeWatchUrl } from "./youtube-thumbnail.ts";

describe("parseYouTubeVideoId", () => {
  it("extracts ids from common YouTube URL shapes", () => {
    assert.equal(
      parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ",
    );
    assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(
      parseYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ",
    );
  });

  it("does not treat Reddit (or other) URLs with a path substring v/ as YouTube", () => {
    assert.equal(
      parseYouTubeVideoId(
        "https://www.reddit.com/r/aigamedev/comments/1abc/v/title/",
      ),
      null,
    );
    assert.equal(
      parseYouTubeVideoId(
        "https://example.com/watch?v=dQw4w9WgXcQ",
      ),
      null,
    );
  });

  it("returns null for non-YouTube / invalid", () => {
    assert.equal(parseYouTubeVideoId("https://example.com/watch?v=abc"), null);
    assert.equal(parseYouTubeVideoId("not-a-url"), null);
  });

  it("isYouTubeWatchUrl mirrors id parse", () => {
    assert.equal(
      isYouTubeWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      true,
    );
    assert.equal(isYouTubeWatchUrl("https://example.com"), false);
  });
});
