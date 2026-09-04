import { describe, expect, it } from "vitest";
import {
  parseStatusFromSyndication,
  stripTrailingMediaShortLinks,
} from "./parse-status.js";

describe("stripTrailingMediaShortLinks (#954)", () => {
  it("removes t.co / pic media short links from tweet text", () => {
    expect(
      stripTrailingMediaShortLinks(
        "hello world https://t.co/qQFTES4fjo",
      ),
    ).toBe("hello world");
    expect(
      stripTrailingMediaShortLinks(
        "see pic https://pic.twitter.com/AbCd https://t.co/x",
      ),
    ).toBe("see pic");
  });
});

describe("parseStatusFromSyndication (#954)", () => {
  it("decodes HTML entities and strips media short links", () => {
    const parsed = parseStatusFromSyndication(
      {
        id_str: "20",
        text: "implement &lt;SPEC&gt; please https://t.co/qQFTES4fjo",
        user: { screen_name: "jack" },
        photos: [
          { url: "https://pbs.twimg.com/media/fixture-status.jpg" },
        ],
      },
      "20",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe("implement <SPEC> please");
    expect(parsed!.text).not.toContain("t.co");
    expect(parsed!.media).toHaveLength(1);
  });

  it("ignores entities.media t.co URLs and keeps pbs CDN", () => {
    const parsed = parseStatusFromSyndication(
      {
        id_str: "20",
        text: "hi https://t.co/qQFTES4fjo",
        user: { screen_name: "jack" },
        photos: [
          { url: "https://pbs.twimg.com/media/HInbJHobUAMaPDB.jpg" },
        ],
        entities: {
          media: [
            {
              url: "https://t.co/qQFTES4fjo",
              display_url: "pic.x.com/qQFTES4fjo",
            },
          ],
        },
      },
      "20",
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.media).toEqual([
      {
        kind: "image",
        url: "https://pbs.twimg.com/media/HInbJHobUAMaPDB.jpg",
      },
    ]);
  });
});
