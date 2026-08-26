import { describe, expect, it } from "vitest";
import {
  INSTAGRAM_TITLE_MAX_LENGTH,
  deriveInstagramTitle,
  listInstagramMediaIntents,
  mergeInstagramIntoNote,
} from "./merge.js";
import type { InstagramFetchSuccess } from "./types.js";

function fetchSuccess(
  overrides: Partial<InstagramFetchSuccess> &
    Pick<InstagramFetchSuccess, "shortcode" | "sourceUrl">,
): InstagramFetchSuccess {
  return {
    authorUsername: "photog",
    caption: "Hello world",
    accessibilityCaption: null,
    media: [
      {
        kind: "image",
        url: "https://cdn.instagram.com/v/t51/x.jpg",
      },
    ],
    ...overrides,
  };
}

describe("deriveInstagramTitle / merge title (#848)", () => {
  it("uses first non-empty caption line", () => {
    const fetch = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "\n\nFirst line title\nSecond line",
    });
    expect(deriveInstagramTitle(fetch)).toBe("First line title");
    expect(mergeInstagramIntoNote({ body: "" }, fetch).title).toBe(
      "First line title",
    );
  });

  it("falls back to @authorUsername when caption is null", () => {
    const fetch = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: null,
      authorUsername: "creator",
    });
    expect(deriveInstagramTitle(fetch)).toBe("@creator");
  });

  it("falls back to @authorUsername when caption has no non-empty line", () => {
    const fetch = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "  \n\t\n  ",
    });
    expect(deriveInstagramTitle(fetch)).toBe("@photog");
  });

  it(`truncates title to ${INSTAGRAM_TITLE_MAX_LENGTH} chars`, () => {
    const long = "x".repeat(INSTAGRAM_TITLE_MAX_LENGTH + 40);
    const fetch = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: long,
    });
    const title = deriveInstagramTitle(fetch);
    expect(title).toHaveLength(INSTAGRAM_TITLE_MAX_LENGTH);
    expect(title).toBe("x".repeat(INSTAGRAM_TITLE_MAX_LENGTH));
  });
});

describe("mergeInstagramIntoNote body (#848)", () => {
  it("uses caption as body text", () => {
    const fetch = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "Caption body\nline two",
    });
    const result = mergeInstagramIntoNote({ body: "" }, fetch);
    expect(result.body).toBe("Caption body\nline two");
  });

  it("includes accessibility section only when provided", () => {
    const withA11y = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "Main caption",
      accessibilityCaption: "Alt description of the photo",
    });
    const merged = mergeInstagramIntoNote({ body: "" }, withA11y);
    expect(merged.body).toContain("Main caption");
    expect(merged.body).toContain("## Accessibility");
    expect(merged.body).toContain("Alt description of the photo");

    const without = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "Main caption",
      accessibilityCaption: null,
    });
    const plain = mergeInstagramIntoNote({ body: "" }, without);
    expect(plain.body).toBe("Main caption");
    expect(plain.body).not.toContain("Accessibility");
  });

  it("does not invent accessibility text when absent or empty", () => {
    const emptyA11y = fetchSuccess({
      shortcode: "AbC",
      sourceUrl: "https://www.instagram.com/p/AbC/",
      caption: "Only caption",
      accessibilityCaption: "   ",
    });
    expect(mergeInstagramIntoNote({ body: "" }, emptyA11y).body).toBe(
      "Only caption",
    );
  });

  it("removes bare Instagram URL from body and sets url to sourceUrl", () => {
    const sourceUrl = "https://www.instagram.com/p/AbC123/";
    const fetch = fetchSuccess({
      shortcode: "AbC123",
      sourceUrl,
      caption: "Post caption",
    });
    const result = mergeInstagramIntoNote(
      { body: `Notes\n\n${sourceUrl}\n\nKeep me` },
      fetch,
    );
    expect(result.url).toBe(sourceUrl);
    expect(result.body).not.toContain("instagram.com");
    expect(result.body).toContain("Post caption");
    expect(result.body).toContain("Notes");
    expect(result.body).toContain("Keep me");
  });

  it("removes markdown Instagram link and matching shortcode forms", () => {
    const sourceUrl = "https://www.instagram.com/reel/ReEl99/";
    const fetch = fetchSuccess({
      shortcode: "ReEl99",
      sourceUrl,
      caption: "Reel caption",
    });
    const body = [
      "Intro paragraph.",
      "",
      "[watch](https://instagram.com/reel/ReEl99/)",
      "",
      "https://m.instagram.com/p/ReEl99/",
      "",
      "Outro stays.",
    ].join("\n");
    const result = mergeInstagramIntoNote({ body }, fetch);
    expect(result.body).not.toMatch(/instagram\.com/i);
    expect(result.body).toContain("Intro paragraph.");
    expect(result.body).toContain("Outro stays.");
    expect(result.body).toContain("Reel caption");
    expect(result.url).toBe(sourceUrl);
  });

  it("preserves extra non-URL paragraphs when caption is empty", () => {
    const sourceUrl = "https://www.instagram.com/p/EmptyCap/";
    const fetch = fetchSuccess({
      shortcode: "EmptyCap",
      sourceUrl,
      caption: null,
      accessibilityCaption: null,
    });
    const result = mergeInstagramIntoNote(
      {
        body: `Keep this prior text.\n\n${sourceUrl}\n\nAnd this too.`,
      },
      fetch,
    );
    expect(result.body).toContain("Keep this prior text.");
    expect(result.body).toContain("And this too.");
    expect(result.body).not.toContain("instagram.com");
    expect(result.title).toBe("@photog");
  });

  it("enriches body with caption when no Instagram URL was in the note", () => {
    const fetch = fetchSuccess({
      shortcode: "NoUrl",
      sourceUrl: "https://www.instagram.com/p/NoUrl/",
      caption: "Fetched caption",
    });
    const result = mergeInstagramIntoNote(
      { body: "Existing thoughts remain." },
      fetch,
    );
    expect(result.body).toContain("Fetched caption");
    expect(result.body).toContain("Existing thoughts remain.");
  });
});

describe("listInstagramMediaIntents (#848)", () => {
  it("covers all media with stable filenames from suggestedFilename or shortcode index", () => {
    const fetch = fetchSuccess({
      shortcode: "Car0u",
      sourceUrl: "https://www.instagram.com/p/Car0u/",
      media: [
        {
          kind: "image",
          url: "https://cdn.instagram.com/t/a.jpg?oe=1",
          suggestedFilename: "hero.jpg",
        },
        {
          kind: "video",
          url: "https://cdn.instagram.com/t/clip/file",
        },
        {
          kind: "image",
          url: "https://cdn.instagram.com/t/b.png",
        },
      ],
    });
    const intents = listInstagramMediaIntents(fetch);
    expect(intents).toEqual([
      {
        kind: "image",
        sourceUrl: "https://cdn.instagram.com/t/a.jpg?oe=1",
        filename: "hero.jpg",
      },
      {
        kind: "video",
        sourceUrl: "https://cdn.instagram.com/t/clip/file",
        filename: "Car0u-2.mp4",
      },
      {
        kind: "image",
        sourceUrl: "https://cdn.instagram.com/t/b.png",
        filename: "Car0u-3.png",
      },
    ]);
    expect(mergeInstagramIntoNote({ body: "" }, fetch).mediaIntents).toEqual(
      intents,
    );
  });

  it("rejects empty suggestedFilename", () => {
    const fetch = fetchSuccess({
      shortcode: "Bad",
      sourceUrl: "https://www.instagram.com/p/Bad/",
      media: [
        {
          kind: "image",
          url: "https://cdn.instagram.com/t/a.jpg",
          suggestedFilename: "  ",
        },
      ],
    });
    expect(() => listInstagramMediaIntents(fetch)).toThrow(
      /suggestedFilename must be non-empty/,
    );
  });
});
