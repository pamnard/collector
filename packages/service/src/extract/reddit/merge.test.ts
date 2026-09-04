import { describe, expect, it } from "vitest";
import {
  deriveRedditTitle,
  listRedditMediaIntents,
  mergeRedditIntoNote,
} from "./merge.js";
import type { RedditFetchSuccess } from "./types.js";

const textFetch: RedditFetchSuccess = {
  sourceUrl:
    "https://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/",
  submissionId: "text01",
  authorUsername: "curious_user",
  title: "Why is the sky blue?",
  selftext: "I was wondering about Rayleigh scattering.\n\nThanks!",
  media: [],
};

const imageFetch: RedditFetchSuccess = {
  sourceUrl: "https://www.reddit.com/r/pics/comments/img001/a_nice_mountain/",
  submissionId: "img001",
  authorUsername: "photog",
  title: "A nice mountain",
  selftext: null,
  media: [{ kind: "image", url: "https://i.redd.it/abc123mountain.jpg" }],
};

describe("mergeRedditIntoNote (#955)", () => {
  it("replaces the Reddit URL with selftext and keeps preamble", () => {
    const merged = mergeRedditIntoNote(
      {
        body: "Note this:\nhttps://www.reddit.com/r/askscience/comments/text01/why_is_the_sky_blue/\n",
      },
      textFetch,
    );
    expect(merged.title).toBe("Why is the sky blue?");
    expect(merged.url).toBe(textFetch.sourceUrl);
    expect(merged.body).toContain("Note this:");
    expect(merged.body).toContain("Rayleigh scattering");
    expect(merged.body).not.toContain("reddit.com");
    expect(merged.mediaIntents).toEqual([]);
  });

  it("strips redd.it companion when bodyUrlKeys include both", () => {
    const merged = mergeRedditIntoNote(
      {
        body: "https://redd.it/img001\nhttps://www.reddit.com/r/pics/comments/img001/a_nice_mountain/",
      },
      imageFetch,
      { bodyUrlKeys: ["reddit:img001", "img001"] },
    );
    expect(merged.body).not.toContain("redd.it");
    expect(merged.body).not.toContain("reddit.com");
    expect(listRedditMediaIntents(imageFetch)).toEqual([
      {
        kind: "image",
        sourceUrl: "https://i.redd.it/abc123mountain.jpg",
        filename: "img001-1.jpg",
      },
    ]);
  });

  it("derives title from selftext when title missing", () => {
    expect(
      deriveRedditTitle({
        ...textFetch,
        title: null,
      }),
    ).toBe("I was wondering about Rayleigh scattering.");
  });
});
