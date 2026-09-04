import { describe, expect, it } from "vitest";
import {
  cookieHeaderFromNetscape,
  loadRedditCookieHeader,
} from "./load-cookie-header.js";

describe("cookieHeaderFromNetscape (#955)", () => {
  it("builds Cookie header for reddit domains only", () => {
    const netscape = `
# Netscape HTTP Cookie File
.reddit.com	TRUE	/	TRUE	0	reddit_session	secret_value
.reddit.com	TRUE	/	FALSE	0	csv	2
.example.com	TRUE	/	FALSE	0	other	x
#HttpOnly_.reddit.com	TRUE	/	TRUE	0	token	abc
`.trim();

    const result = cookieHeaderFromNetscape(netscape, ["reddit.com"]);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(3);
    expect(result!.header).toContain("reddit_session=secret_value");
    expect(result!.header).toContain("csv=2");
    expect(result!.header).toContain("token=abc");
    expect(result!.header).not.toContain("other=");
  });

  it("returns null when no matching domains", () => {
    expect(
      cookieHeaderFromNetscape(
        ".example.com\tTRUE\t/\tFALSE\t0\tother\tx\n",
        ["reddit.com"],
      ),
    ).toBeNull();
  });
});

describe("loadRedditCookieHeader (#955)", () => {
  it("fails when cookies browser is unavailable", async () => {
    const result = await loadRedditCookieHeader({
      cookiesBrowser: null,
      ytdlpBinary: "/usr/bin/true",
      execFileImpl: async () => {
        throw new Error("exec must not run");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.code).toBe("cookies_unavailable");
  });

  it("parses Netscape dump from yt-dlp without logging values", async () => {
    const netscape = `.reddit.com\tTRUE\t/\tTRUE\t0\treddit_session\tok_token\n`;
    const result = await loadRedditCookieHeader({
      cookiesBrowser: "chrome:Default",
      ytdlpBinary: "/fake/yt-dlp",
      execFileImpl: async (_file, args) => {
        const cookieIdx = args.indexOf("--cookies");
        const cookieFile = args[cookieIdx + 1];
        if (typeof cookieFile !== "string") {
          throw new Error("missing --cookies path");
        }
        const { writeFileSync } = await import("node:fs");
        writeFileSync(cookieFile, netscape, "utf8");
        // Simulate yt-dlp non-zero exit after writing cookies (Unsupported URL).
        throw new Error("ERROR: Unsupported URL: https://www.reddit.com/");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected success");
    }
    expect(result.cookieCount).toBe(1);
    expect(result.cookieHeader).toBe("reddit_session=ok_token");
  });
});
