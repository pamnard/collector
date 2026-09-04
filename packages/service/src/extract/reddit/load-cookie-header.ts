/**
 * Load a Cookie header for Reddit domains via bundled yt-dlp (#955).
 * Never log cookie values or Netscape dump contents.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveYtdlpBinary } from "../youtube/resolve-ytdlp.js";
import { listRedditCookiesBrowserCandidates } from "./resolve-cookies-browser.js";

const defaultExecFile = promisify(execFile);

export type RedditCookieExecFile = (
  file: string,
  args: readonly string[],
  options: { maxBuffer?: number; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type LoadRedditCookieHeaderOptions = {
  /**
   * Override `--cookies-from-browser` (tests / env).
   * When omitted, tries ordered auto-detect candidates until `reddit_session`
   * is present.
   */
  cookiesBrowser?: string | null;
  /** Override yt-dlp path (tests). */
  ytdlpBinary?: string | null;
  execFileImpl?: RedditCookieExecFile;
  /** Domains to keep from the Netscape dump (host suffix match). */
  domains?: string[];
};

export type LoadRedditCookieHeaderResult =
  | { ok: true; cookieHeader: string; cookieCount: number }
  | { ok: false; code: "cookies_unavailable"; message: string };

const DEFAULT_DOMAINS = [
  "reddit.com",
  "redd.it",
  "redditmedia.com",
];

const REDDIT_SESSION_COOKIE = "reddit_session";

/**
 * Dump browser cookies with yt-dlp and build an HTTP Cookie header for Reddit.
 */
export async function loadRedditCookieHeader(
  options: LoadRedditCookieHeaderOptions = {},
): Promise<LoadRedditCookieHeaderResult> {
  const candidates =
    options.cookiesBrowser === undefined
      ? listRedditCookiesBrowserCandidates()
      : options.cookiesBrowser === null || options.cookiesBrowser.trim().length === 0
        ? []
        : [options.cookiesBrowser.trim()];

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "cookies_unavailable",
      message:
        "Reddit extract needs Chrome/Chromium cookies (log into Reddit in the browser, or set COLLECTOR_REDDIT_COOKIES_BROWSER)",
    };
  }

  const ytdlp =
    options.ytdlpBinary === undefined
      ? resolveYtdlpBinary()
      : options.ytdlpBinary;
  if (ytdlp === null || ytdlp.trim().length === 0) {
    return {
      ok: false,
      code: "cookies_unavailable",
      message:
        "yt-dlp binary not found (needed to read browser cookies for Reddit)",
    };
  }

  const runExec = options.execFileImpl ?? defaultExecFile;
  const domains = options.domains ?? DEFAULT_DOMAINS;

  let lastError: string | null = null;
  for (const cookiesBrowser of candidates) {
    const dumped = await dumpCookieHeaderForBrowser({
      ytdlp,
      cookiesBrowser,
      domains,
      runExec,
    });
    if (!dumped.ok) {
      lastError = dumped.message;
      continue;
    }
    if (!cookieHeaderHasName(dumped.cookieHeader, REDDIT_SESSION_COOKIE)) {
      lastError =
        "Browser profile has Reddit cookies but no reddit_session (log into Reddit in that profile)";
      continue;
    }
    return dumped;
  }

  return {
    ok: false,
    code: "cookies_unavailable",
    message:
      lastError ??
      "No Chrome/Chromium profile had a Reddit login (reddit_session)",
  };
}

async function dumpCookieHeaderForBrowser(input: {
  ytdlp: string;
  cookiesBrowser: string;
  domains: string[];
  runExec: RedditCookieExecFile;
}): Promise<LoadRedditCookieHeaderResult> {
  const workDir = mkdtempSync(join(tmpdir(), "collector-reddit-cookies-"));
  const cookieFile = join(workDir, "cookies.txt");

  try {
    // Do not pre-create cookieFile: an empty file makes yt-dlp reject it as
    // "does not look like a Netscape format cookies file" before writing.
    try {
      await input.runExec(
        input.ytdlp,
        [
          "--cookies-from-browser",
          input.cookiesBrowser,
          "--cookies",
          cookieFile,
          "--skip-download",
          "--no-warnings",
          // Any https host is fine — we only need the cookie dump side effect.
          // Reddit homepage may exit non-zero ("Unsupported URL"); cookies are
          // still written first.
          "https://www.reddit.com/",
        ],
        {
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        },
      );
    } catch (error) {
      if (!existsSync(cookieFile) || statSync(cookieFile).size === 0) {
        const errMessage =
          error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: "cookies_unavailable",
          message: `Failed to dump Reddit cookies from browser (${summarizeYtdlpError(errMessage)})`,
        };
      }
    }

    if (!existsSync(cookieFile) || statSync(cookieFile).size === 0) {
      return {
        ok: false,
        code: "cookies_unavailable",
        message: "yt-dlp did not write a browser cookie dump for Reddit",
      };
    }

    const netscape = readFileSync(cookieFile, "utf8");
    const cookieHeader = cookieHeaderFromNetscape(netscape, input.domains);
    if (cookieHeader === null) {
      return {
        ok: false,
        code: "cookies_unavailable",
        message:
          "Browser cookie dump had no Reddit-domain cookies (log into Reddit in Chrome/Chromium)",
      };
    }
    return {
      ok: true,
      cookieHeader: cookieHeader.header,
      cookieCount: cookieHeader.count,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function cookieHeaderHasName(header: string, name: string): boolean {
  const needle = `${name}=`;
  return header.split("; ").some((part) => part.startsWith(needle));
}

function summarizeYtdlpError(message: string): string {
  if (/could not (find|copy) cookies/i.test(message)) {
    return "could not read browser cookie database";
  }
  if (/is locked|database is locked/i.test(message)) {
    return "browser cookie database is locked";
  }
  if (/no such browser/i.test(message)) {
    return "browser profile not found";
  }
  return "yt-dlp cookies-from-browser failed";
}

/**
 * Parse Netscape cookie file into Cookie header for matching domains.
 * Returns null when no cookies match.
 */
export function cookieHeaderFromNetscape(
  netscapeText: string,
  domains: string[],
): { header: string; count: number } | null {
  const pairs: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();

  for (const line of netscapeText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      // Netscape httpOnly marker: #HttpOnly_.reddit.com ...
      if (!trimmed.startsWith("#HttpOnly_")) {
        continue;
      }
    }
    const raw = trimmed.startsWith("#HttpOnly_")
      ? trimmed.slice("#HttpOnly_".length)
      : trimmed;
    if (raw.startsWith("#")) {
      continue;
    }
    const cols = raw.split("\t");
    if (cols.length < 7) {
      continue;
    }
    const domain = cols[0]!.trim().toLowerCase();
    const name = cols[5]!;
    const value = cols[6]!;
    if (!name || value === undefined) {
      continue;
    }
    if (!domainMatches(domain, domains)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    pairs.push({ name, value });
  }

  if (pairs.length === 0) {
    return null;
  }
  return {
    header: pairs.map((p) => `${p.name}=${p.value}`).join("; "),
    count: pairs.length,
  };
}

function domainMatches(cookieDomain: string, wanted: string[]): boolean {
  const host = cookieDomain.replace(/^\./, "");
  return wanted.some((suffix) => {
    const s = suffix.replace(/^\./, "").toLowerCase();
    return host === s || host.endsWith(`.${s}`);
  });
}
