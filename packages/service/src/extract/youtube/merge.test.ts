import { describe, expect, it } from "vitest";
import { stripSubtitleMarkup } from "./fetch.js";
import {
  deriveYoutubeTitle,
  listYoutubeMediaIntents,
  mergeYoutubeIntoNote,
} from "./merge.js";
import type { YoutubeFetchSuccess } from "./types.js";

const SAMPLE_PATH = "/tmp/collector-yt-fixture/dQw4w9WgXcQ.mp4";

function sampleFetch(
  overrides: Partial<YoutubeFetchSuccess> = {},
): YoutubeFetchSuccess {
  return {
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    transcript: "We're no strangers to love\nYou know the rules",
    videoPath: SAMPLE_PATH,
    videoFilename: "dQw4w9WgXcQ.mp4",
    release: () => undefined,
    ...overrides,
  };
}

describe("deriveYoutubeTitle (#317)", () => {
  it("uses the video title", () => {
    expect(deriveYoutubeTitle(sampleFetch())).toBe("Never Gonna Give You Up");
  });

  it("fails when title is empty", () => {
    expect(() => deriveYoutubeTitle(sampleFetch({ title: "  \n  " }))).toThrow(
      /no_title/,
    );
  });
});

describe("stripSubtitleMarkup (#317)", () => {
  it("strips SRT timings to plain lines", () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:02,000",
      "Hello world",
      "",
      "2",
      "00:00:02,000 --> 00:00:04,000",
      "Second line",
    ].join("\n");
    expect(stripSubtitleMarkup(srt)).toBe("Hello world\nSecond line");
  });
});

describe("mergeYoutubeIntoNote body (#317)", () => {
  it("replaces YouTube URL with transcript and preserves preamble", () => {
    const merged = mergeYoutubeIntoNote(
      {
        body: "Keep preamble\n\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n",
      },
      sampleFetch(),
    );
    expect(merged.title).toBe("Never Gonna Give You Up");
    expect(merged.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(merged.body).toContain("Keep preamble");
    expect(merged.body).toContain("We're no strangers to love");
    expect(merged.body).not.toContain("youtube.com/watch");
  });

  it("strips URL without inventing transcript when absent", () => {
    const merged = mergeYoutubeIntoNote(
      { body: "Note https://youtu.be/dQw4w9WgXcQ end\n" },
      sampleFetch({ transcript: null }),
    );
    expect(merged.body).toContain("Note");
    expect(merged.body).toContain("end");
    expect(merged.body).not.toContain("youtu.be");
    expect(merged.body).not.toContain("strangers");
  });

  it("lists stable media path from fetch", () => {
    const intents = listYoutubeMediaIntents(sampleFetch());
    expect(intents).toEqual([
      {
        kind: "video",
        filename: "dQw4w9WgXcQ.mp4",
        absolutePath: SAMPLE_PATH,
      },
    ]);
  });
});
