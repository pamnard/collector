/**
 * fetchYoutubeVideo — mocked execFile (no live yt-dlp / network).
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  YOUTUBE_FORMAT,
  YOUTUBE_MAX_FILESIZE,
  classifyYtdlpFailure,
  fetchYoutubeVideo,
} from "./fetch.js";

const OK_ID = "dQw4w9WgXcQ";
const OK_URL = `https://www.youtube.com/watch?v=${OK_ID}`;

describe("classifyYtdlpFailure (#317)", () => {
  it("maps bot wall stderr to bot_wall", () => {
    const result = classifyYtdlpFailure({
      message: "Command failed",
      stderr:
        "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser",
    });
    expect(result.code).toBe("bot_wall");
    expect(result.message).toContain("bot wall");
  });

  it("maps missing cookie DB to cookies_unavailable", () => {
    const result = classifyYtdlpFailure({
      message: "Command failed",
      stderr: 'ERROR: could not find chromium cookies database in "/tmp/x"',
    });
    expect(result.code).toBe("cookies_unavailable");
  });
});

describe("fetchYoutubeVideo (#317)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns cookies_unavailable when browser cookies cannot be resolved", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/usr/bin/true",
      cookiesBrowser: null,
      execFileImpl: async () => {
        throw new Error("exec must not run");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("cookies_unavailable");
    expect(result.message).toContain("COLLECTOR_YT_COOKIES_BROWSER");
  });

  it("passes format, cookies, js-runtimes and downloads video bytes", async () => {
    const workProbe: { args: string[][] } = { args: [] };
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      nodeBinary: "/fake/node",
      ffmpegBinary: null,
      execFileImpl: async (_file, args) => {
        workProbe.args.push([...args]);
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        if (args.includes("--skip-download")) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, `${OK_ID}.en.srt`),
            "1\n00:00:00,000 --> 00:00:01,000\nHello transcript\n",
          );
          return { stdout: "", stderr: "" };
        }
        mkdirSync(dir, { recursive: true });
        const videoPath = join(dir, `${OK_ID}.mp4`);
        writeFileSync(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18]));
        return {
          stdout: `Fixture Title\n${videoPath}\n`,
          stderr: "",
        };
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.title).toBe("Fixture Title");
    expect(result.value.videoFilename).toBe(`${OK_ID}.mp4`);
    expect(Array.from(result.value.videoBytes)).toEqual([0x00, 0x00, 0x00, 0x18]);
    expect(result.value.transcript).toContain("Hello transcript");

    const videoArgs = workProbe.args[0] ?? [];
    expect(videoArgs).toContain("--cookies-from-browser");
    expect(videoArgs).toContain("chrome:Profile 3");
    expect(videoArgs).toContain("--js-runtimes");
    expect(videoArgs).toContain("node:/fake/node");
    expect(videoArgs).toContain("-f");
    expect(videoArgs).toContain(YOUTUBE_FORMAT);
    expect(videoArgs).toContain("--max-filesize");
    expect(videoArgs).toContain(YOUTUBE_MAX_FILESIZE);
    expect(videoArgs).not.toContain("-i");
  });

  it("maps bot-wall exec failure", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      execFileImpl: async () => {
        const err = new Error("Command failed: yt-dlp") as Error & {
          stderr: string;
        };
        err.stderr =
          "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot.";
        throw err;
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("bot_wall");
    expect(result.message).toContain("bot wall");
  });
});
