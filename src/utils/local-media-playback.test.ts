import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalVideoItem,
  isYouTubeItemUrl,
  pickPlayableMedia,
} from "./local-media-playback.ts";

describe("isYouTubeItemUrl", () => {
  it("detects youtube watch urls", () => {
    assert.equal(
      isYouTubeItemUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      true,
    );
  });

  it("rejects empty and non-youtube", () => {
    assert.equal(isYouTubeItemUrl(null), false);
    assert.equal(isYouTubeItemUrl("https://example.com/v.mp4"), false);
  });
});

describe("isLocalVideoItem", () => {
  it("is true for video without youtube url", () => {
    assert.equal(
      isLocalVideoItem({ content_type: "video", url: null }),
      true,
    );
  });

  it("is false for youtube video bookmarks", () => {
    assert.equal(
      isLocalVideoItem({
        content_type: "video",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
      false,
    );
  });

  it("is false for non-video types", () => {
    assert.equal(
      isLocalVideoItem({ content_type: "image", url: null }),
      false,
    );
  });
});

describe("pickPlayableMedia", () => {
  const files = [
    {
      media_type: "image",
      absolute_path: "/vault/a/img.png",
    },
    {
      media_type: "audio",
      absolute_path: "/vault/a/track.mp3",
    },
    {
      media_type: "video",
      absolute_path: "/vault/a/clip.mp4",
    },
  ];

  it("prefers video when requested", () => {
    assert.deepEqual(pickPlayableMedia(files, "video"), {
      path: "/vault/a/clip.mp4",
      kind: "video",
    });
  });

  it("prefers audio when requested", () => {
    assert.deepEqual(pickPlayableMedia(files, "audio"), {
      path: "/vault/a/track.mp3",
      kind: "audio",
    });
  });

  it("defaults to video then audio", () => {
    assert.deepEqual(pickPlayableMedia(files), {
      path: "/vault/a/clip.mp4",
      kind: "video",
    });
    assert.deepEqual(
      pickPlayableMedia(files.filter((file) => file.media_type !== "video")),
      { path: "/vault/a/track.mp3", kind: "audio" },
    );
  });

  it("returns null when nothing playable", () => {
    assert.equal(
      pickPlayableMedia([{ media_type: "image", absolute_path: "/x" }]),
      null,
    );
  });
});
