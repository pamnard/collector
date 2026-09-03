import { describe, expect, it } from "vitest";
import {
  derivePinterestTitle,
  listPinterestMediaIntents,
  mergePinterestIntoNote,
} from "./merge.js";
import type { PinterestFetchSuccess } from "./types.js";

function sampleFetch(
  overrides: Partial<PinterestFetchSuccess> = {},
): PinterestFetchSuccess {
  return {
    sourceUrl: "https://www.pinterest.com/pin/111222333444/",
    pinId: "111222333444",
    authorUsername: "fixture_user",
    title: "Morning ride",
    description: "Morning ride\n#bike",
    media: [
      {
        kind: "image",
        url: "https://cdn.pinterest.fixture/single.jpg",
      },
    ],
    ...overrides,
  };
}

describe("derivePinterestTitle (#34)", () => {
  it("uses title, then description, then @user, then fallback", () => {
    expect(derivePinterestTitle(sampleFetch())).toBe("Morning ride");
    expect(
      derivePinterestTitle(
        sampleFetch({ title: null, description: "Only desc line" }),
      ),
    ).toBe("Only desc line");
    expect(
      derivePinterestTitle(
        sampleFetch({ title: null, description: null }),
      ),
    ).toBe("@fixture_user");
    expect(
      derivePinterestTitle(
        sampleFetch({
          title: null,
          description: null,
          authorUsername: null,
        }),
      ),
    ).toBe("Pinterest pin");
  });
});

describe("mergePinterestIntoNote body (#34)", () => {
  it("replaces pin URL with description and preserves preamble", () => {
    const merged = mergePinterestIntoNote(
      {
        body: "Keep preamble\n\nhttps://www.pinterest.com/pin/111222333444/\n",
      },
      sampleFetch(),
    );
    expect(merged.title).toBe("Morning ride");
    expect(merged.url).toBe("https://www.pinterest.com/pin/111222333444/");
    expect(merged.body).toContain("Keep preamble");
    expect(merged.body).toContain("Morning ride");
    expect(merged.body).toContain("#bike");
    expect(merged.body).not.toContain("pinterest.com/pin/111222333444");
  });

  it("strips pin.it when bodyUrlKeys include pinit code", () => {
    const merged = mergePinterestIntoNote(
      { body: "Take a look! https://pin.it/1uTuGaTJV\n" },
      sampleFetch(),
      { bodyUrlKeys: ["pinit:1uTuGaTJV", "111222333444"] },
    );
    expect(merged.body).not.toContain("pin.it");
    expect(merged.body).toContain("Morning ride");
  });

  it("lists stable media filenames", () => {
    const intents = listPinterestMediaIntents(
      sampleFetch({
        media: [
          {
            kind: "video",
            url: "https://cdn.pinterest.fixture/v.mp4",
          },
          {
            kind: "image",
            url: "https://cdn.pinterest.fixture/i.jpg",
          },
        ],
      }),
    );
    expect(intents.map((i) => i.filename)).toEqual([
      "111222333444-1.mp4",
      "111222333444-2.jpg",
    ]);
  });
});
