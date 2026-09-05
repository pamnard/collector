/**
 * fetchYoutubeVideo — mocked execFile (no live yt-dlp / network).
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  YOUTUBE_DOWNLOAD_TIMEOUT_MS,
  classifyYtdlpFailure,
  fetchYoutubeVideo,
  findDownloadedVideo,
  isYtdlpFragmentFilename,
  probeVideoHasAudio,
  resolveFfprobeBesideFfmpeg,
} from "./fetch.js";
import { youtubeFormatForMaxHeight } from "./duration-height.js";

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

describe("isYtdlpFragmentFilename / findDownloadedVideo", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects intermediate fNNN fragments", () => {
    expect(isYtdlpFragmentFilename(`${OK_ID}.f160.mp4`, OK_ID)).toBe(true);
    expect(isYtdlpFragmentFilename(`${OK_ID}.mp4`, OK_ID)).toBe(false);
  });

  it("rejects fragment-only workdirs as incomplete", () => {
    const dir = join(
      process.env.TMPDIR ?? "/tmp",
      `collector-yt-frag-${Date.now()}`,
    );
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${OK_ID}.f160.mp4`), Buffer.from([1, 2, 3, 4]));
    expect(findDownloadedVideo(dir, OK_ID, [])).toBeNull();
  });

  it("accepts merged output filename", () => {
    const dir = join(
      process.env.TMPDIR ?? "/tmp",
      `collector-yt-ok-${Date.now()}`,
    );
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const videoPath = join(dir, `${OK_ID}.mp4`);
    writeFileSync(videoPath, Buffer.from([1, 2, 3, 4]));
    expect(findDownloadedVideo(dir, OK_ID, [videoPath])).toBe(videoPath);
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

  it("probes duration, selects height format, skips max-filesize, returns path", async () => {
    const workProbe: { args: string[][] } = { args: [] };
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      nodeBinary: "/fake/node",
      ffmpegBinary: null,
      probeHasAudioImpl: async () => true,
      execFileImpl: async (_file, args) => {
        workProbe.args.push([...args]);
        if (args.includes("--skip-download") && args.includes("%(duration)s")) {
          return { stdout: "1800\n", stderr: "" };
        }
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        if (args.includes("--write-auto-subs")) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, `${OK_ID}.en.srt`),
            "1\n00:00:00,000 --> 00:00:01,000\nHello transcript\n",
          );
          return { stdout: "", stderr: "" };
        }
        mkdirSync(dir, { recursive: true });
        dirs.push(dir);
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
    expect(result.value.videoPath.endsWith(`${OK_ID}.mp4`)).toBe(true);
    expect(result.value.transcript).toContain("Hello transcript");
    result.value.release();

    const probeArgs = workProbe.args[0] ?? [];
    expect(probeArgs).toContain("--skip-download");
    expect(probeArgs).toContain("%(duration)s");

    const videoArgs = workProbe.args[1] ?? [];
    expect(videoArgs).toContain("--cookies-from-browser");
    expect(videoArgs).toContain("chrome:Profile 3");
    expect(videoArgs).toContain("--js-runtimes");
    expect(videoArgs).toContain("node:/fake/node");
    expect(videoArgs).toContain("-f");
    expect(videoArgs).toContain(youtubeFormatForMaxHeight(720));
    expect(videoArgs).not.toContain("--max-filesize");
    expect(videoArgs).not.toContain("-i");
  });

  it("uses 480p format when duration is over one hour", async () => {
    const workProbe: { args: string[][] } = { args: [] };
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      probeHasAudioImpl: async () => true,
      execFileImpl: async (_file, args) => {
        workProbe.args.push([...args]);
        if (args.includes("%(duration)s")) {
          return { stdout: "3601\n", stderr: "" };
        }
        if (args.includes("--write-auto-subs")) {
          return { stdout: "", stderr: "" };
        }
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        mkdirSync(dir, { recursive: true });
        dirs.push(dir);
        const videoPath = join(dir, `${OK_ID}.mp4`);
        writeFileSync(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18]));
        return { stdout: `Long\n${videoPath}\n`, stderr: "" };
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.value.release();
    }
    const videoArgs = workProbe.args[1] ?? [];
    expect(videoArgs).toContain(youtubeFormatForMaxHeight(480));
  });

  it("fails no_audio when probe reports silence", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      probeHasAudioImpl: async () => false,
      execFileImpl: async (_file, args) => {
        if (args.includes("%(duration)s")) {
          return { stdout: "120\n", stderr: "" };
        }
        if (args.includes("--write-auto-subs")) {
          return { stdout: "", stderr: "" };
        }
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        mkdirSync(dir, { recursive: true });
        dirs.push(dir);
        const videoPath = join(dir, `${OK_ID}.mp4`);
        writeFileSync(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18]));
        return { stdout: `Silent\n${videoPath}\n`, stderr: "" };
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("no_audio");
  });

  it("fails incomplete_download when only a fragment remains", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      probeHasAudioImpl: async () => true,
      execFileImpl: async (_file, args) => {
        if (args.includes("%(duration)s")) {
          return { stdout: "120\n", stderr: "" };
        }
        if (args.includes("--write-auto-subs")) {
          return { stdout: "", stderr: "" };
        }
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        mkdirSync(dir, { recursive: true });
        dirs.push(dir);
        writeFileSync(
          join(dir, `${OK_ID}.f160.mp4`),
          Buffer.from([0x00, 0x00, 0x00, 0x18]),
        );
        return { stdout: "Frag\n", stderr: "" };
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("incomplete_download");
  });

  it("fails no_duration when probe yields empty duration", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      execFileImpl: async (_file, args) => {
        if (args.includes("%(duration)s")) {
          return { stdout: "\n", stderr: "" };
        }
        throw new Error("download must not run");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("no_duration");
  });

  it("maps bot-wall on duration probe (not no_duration)", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      execFileImpl: async (_file, args) => {
        if (args.includes("%(duration)s")) {
          const err = new Error("Command failed: yt-dlp") as Error & {
            stderr: string;
          };
          err.stderr =
            "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot.";
          throw err;
        }
        throw new Error("download must not run");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("bot_wall");
  });

  it("uses a three-hour download timeout", async () => {
    let seenTimeout: number | undefined;
    await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      probeHasAudioImpl: async () => true,
      execFileImpl: async (_file, args, options) => {
        if (args.includes("%(duration)s")) {
          return { stdout: "60\n", stderr: "" };
        }
        if (args.includes("--write-auto-subs")) {
          return { stdout: "", stderr: "" };
        }
        seenTimeout = options.timeout;
        const outIdx = args.indexOf("-o");
        const template = args[outIdx + 1] ?? "";
        const dir = template.replace(/%\(id\)s\.%\(ext\)s$/, "");
        mkdirSync(dir, { recursive: true });
        dirs.push(dir);
        const videoPath = join(dir, `${OK_ID}.mp4`);
        writeFileSync(videoPath, Buffer.from([1]));
        return { stdout: `T\n${videoPath}\n`, stderr: "" };
      },
    }).then((result) => {
      if (result.ok) {
        result.value.release();
      }
    });
    expect(seenTimeout).toBe(YOUTUBE_DOWNLOAD_TIMEOUT_MS);
  });

  it("maps bot-wall exec failure", async () => {
    const result = await fetchYoutubeVideo(OK_URL, {
      ytdlpBinary: "/fake/yt-dlp",
      cookiesBrowser: "chrome:Profile 3",
      execFileImpl: async (_file, args) => {
        if (args.includes("%(duration)s")) {
          return { stdout: "60\n", stderr: "" };
        }
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

describe("resolveFfprobeBesideFfmpeg", () => {
  it("returns null for bare ffmpeg name (no invented PATH probe)", () => {
    expect(resolveFfprobeBesideFfmpeg("ffmpeg")).toBeNull();
    expect(resolveFfprobeBesideFfmpeg(null)).toBeNull();
    expect(resolveFfprobeBesideFfmpeg(undefined)).toBeNull();
  });

  it("returns sibling ffprobe when it exists next to a full-path ffmpeg", () => {
    expect(resolveFfprobeBesideFfmpeg("/usr/bin/ffmpeg")).toBe(
      "/usr/bin/ffprobe",
    );
  });
});

describe("probeVideoHasAudio (ffmpeg fixture)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects audio vs silent streams", async () => {
    const dir = join("/tmp", `collector-audio-probe-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    const withAudio = join(dir, "with-audio.mp4");
    const silent = join(dir, "silent.mp4");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=0.2",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=0.2",
      "-shortest",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-y",
      withAudio,
    ]);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x16:d=0.2",
      "-c:v",
      "libx264",
      "-an",
      "-y",
      silent,
    ]);

    await expect(probeVideoHasAudio(withAudio, "/usr/bin/ffmpeg")).resolves.toBe(
      true,
    );
    await expect(probeVideoHasAudio(silent, "/usr/bin/ffmpeg")).resolves.toBe(
      false,
    );
    // Force ffmpeg -i path (no sibling ffprobe).
    await expect(probeVideoHasAudio(withAudio, "ffmpeg")).resolves.toBe(true);
    await expect(probeVideoHasAudio(silent, "ffmpeg")).resolves.toBe(false);
  });
});
