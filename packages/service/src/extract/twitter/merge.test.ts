import { describe, expect, it } from "vitest";
import {
  deriveTwitterTitle,
  listTwitterMediaIntents,
  mergeTwitterIntoNote,
} from "./merge.js";
import type { TwitterFetchSuccess } from "./types.js";

function sampleStatus(
  overrides: Partial<TwitterFetchSuccess> = {},
): TwitterFetchSuccess {
  return {
    kind: "status",
    sourceUrl: "https://x.com/jack/status/20",
    contentId: "20",
    authorUsername: "jack",
    title: null,
    text: "just setting up my twttr",
    media: [
      {
        kind: "image",
        url: "https://pbs.twimg.com/media/fixture-status.jpg",
      },
    ],
    ...overrides,
  };
}

function sampleArticle(
  overrides: Partial<TwitterFetchSuccess> = {},
): TwitterFetchSuccess {
  return {
    kind: "article",
    sourceUrl: "https://x.com/writer/article/ArtId01",
    contentId: "ArtId01",
    authorUsername: "writer",
    title: "Deep dive into notes",
    text: "Full article body paragraph one.\n\nParagraph two.",
    media: [
      {
        kind: "image",
        url: "https://pbs.twimg.com/media/fixture-article.jpg",
      },
    ],
    ...overrides,
  };
}

describe("deriveTwitterTitle (#954)", () => {
  it("uses title, then text, then @user, then fallback", () => {
    expect(deriveTwitterTitle(sampleArticle())).toBe("Deep dive into notes");
    expect(deriveTwitterTitle(sampleStatus())).toBe(
      "just setting up my twttr",
    );
    expect(
      deriveTwitterTitle(
        sampleStatus({ text: null, title: null }),
      ),
    ).toBe("@jack");
    expect(
      deriveTwitterTitle(
        sampleStatus({ text: null, title: null, authorUsername: null }),
      ),
    ).toBe("X post");
  });
});

describe("mergeTwitterIntoNote (#954)", () => {
  it("replaces status URL with text and preserves preamble", () => {
    const merged = mergeTwitterIntoNote(
      {
        body: "Keep preamble\n\nhttps://x.com/jack/status/20\n",
      },
      sampleStatus(),
    );
    expect(merged.title).toBe("just setting up my twttr");
    expect(merged.url).toBe("https://x.com/jack/status/20");
    expect(merged.body).toContain("Keep preamble");
    expect(merged.body).toContain("just setting up my twttr");
    expect(merged.body).not.toContain("x.com/jack/status/20");
  });

  it("strips t.co when bodyUrlKeys include tco code", () => {
    const merged = mergeTwitterIntoNote(
      { body: "Take a look! https://t.co/AbCdEfGh\n" },
      sampleStatus(),
      { bodyUrlKeys: ["tco:AbCdEfGh", "20"] },
    );
    expect(merged.body).not.toContain("t.co");
    expect(merged.body).toContain("just setting up my twttr");
  });

  it("keeps full article text in body and inlines media for localize", () => {
    const merged = mergeTwitterIntoNote(
      { body: "https://x.com/writer/article/ArtId01\n" },
      sampleArticle(),
    );
    expect(merged.body).toContain("Full article body paragraph one.");
    expect(merged.body).toContain("Paragraph two.");
    expect(merged.body).toContain(
      "![](https://pbs.twimg.com/media/fixture-article.jpg)",
    );
    expect(merged.body).not.toContain("/article/");
    expect(merged.mediaIntents).toHaveLength(1);
    expect(merged.mediaIntents[0]!.filename).toBe("ArtId01-1.jpg");
  });

  it("allows text-only with zero media intents", () => {
    const merged = mergeTwitterIntoNote(
      { body: "https://x.com/jack/status/20\n" },
      sampleStatus({ media: [] }),
    );
    expect(merged.mediaIntents).toEqual([]);
    expect(merged.body).toContain("just setting up my twttr");
  });

  it("lists stable media filenames", () => {
    const intents = listTwitterMediaIntents(
      sampleStatus({
        media: [
          {
            kind: "video",
            url: "https://video.twimg.com/v.mp4",
          },
          {
            kind: "image",
            url: "https://pbs.twimg.com/media/i.jpg",
          },
        ],
      }),
    );
    expect(intents.map((i) => i.filename)).toEqual(["20-1.mp4", "20-2.jpg"]);
    expect(listTwitterMediaIntents(sampleArticle()).map((i) => i.filename)).toEqual(
      ["ArtId01-1.jpg"],
    );
  });
});
