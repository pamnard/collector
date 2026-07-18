import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleExternalLinkClick,
  isExternalHttpUrl,
} from "./open-external-url.ts";

describe("isExternalHttpUrl", () => {
  it("accepts http and https", () => {
    assert.equal(isExternalHttpUrl("https://example.com/path"), true);
    assert.equal(isExternalHttpUrl("http://example.com"), true);
  });

  it("rejects non-http schemes and relative hrefs", () => {
    assert.equal(isExternalHttpUrl("/local/path"), false);
    assert.equal(isExternalHttpUrl("mailto:a@b.c"), false);
    assert.equal(isExternalHttpUrl("javascript:alert(1)"), false);
    assert.equal(isExternalHttpUrl(""), false);
  });
});

describe("handleExternalLinkClick", () => {
  it("prevents default and opens http(s) urls", async () => {
    const opened: string[] = [];
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
    };

    const handled = handleExternalLinkClick(
      event,
      "https://example.com/item",
      async (url) => {
        opened.push(url);
      },
    );

    assert.equal(handled, true);
    assert.equal(prevented, true);
    await Promise.resolve();
    assert.deepEqual(opened, ["https://example.com/item"]);
  });

  it("leaves non-external links alone", () => {
    let prevented = false;
    const opened: string[] = [];
    const event = {
      preventDefault() {
        prevented = true;
      },
    };

    const handled = handleExternalLinkClick(event, "/relative", async (url) => {
      opened.push(url);
    });

    assert.equal(handled, false);
    assert.equal(prevented, false);
    assert.deepEqual(opened, []);
  });

  it("leaves missing href alone", () => {
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
    };

    assert.equal(
      handleExternalLinkClick(event, undefined, async () => {
        throw new Error("should not open");
      }),
      false,
    );
    assert.equal(prevented, false);
  });
});
