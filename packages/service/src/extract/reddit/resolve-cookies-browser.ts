/**
 * Pick browser cookies for Reddit HTTP extract (#955).
 * Parallel to YouTube's resolver — intentional duplicate until a shared
 * refactor is justified.
 *
 * Auto-detect returns an ordered candidate list (preferred profile first,
 * then other profiles under the same browser) so the cookie loader can pick
 * the profile that actually has a Reddit login (`reddit_session`).
 *
 * COLLECTOR_REDDIT_COOKIES_BROWSER overrides auto-detect (e.g. `chrome:Default`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type RedditCookieBrowserKind = "chrome" | "chromium";

/**
 * Ordered yt-dlp `--cookies-from-browser` candidates, e.g. `chrome:Default`.
 * Empty = no usable Chrome/Chromium profile.
 */
export function listRedditCookiesBrowserCandidates(): string[] {
  const fromEnv = process.env.COLLECTOR_REDDIT_COOKIES_BROWSER?.trim();
  if (fromEnv) {
    return [fromEnv];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of listRedditCookieBrowserUserDataDirs()) {
    const profiles = listProfilesForUserDataDir(candidate.userDataDir);
    for (const profile of profiles) {
      const key = `${candidate.browser}:${profile}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export function listRedditCookieBrowserUserDataDirs(): Array<{
  browser: RedditCookieBrowserKind;
  userDataDir: string;
}> {
  const home = homedir();
  if (process.platform === "linux") {
    return [
      { browser: "chrome", userDataDir: join(home, ".config", "google-chrome") },
      { browser: "chromium", userDataDir: join(home, ".config", "chromium") },
    ];
  }
  if (process.platform === "darwin") {
    return [
      {
        browser: "chrome",
        userDataDir: join(
          home,
          "Library",
          "Application Support",
          "Google",
          "Chrome",
        ),
      },
      {
        browser: "chromium",
        userDataDir: join(
          home,
          "Library",
          "Application Support",
          "Chromium",
        ),
      },
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA?.trim();
    if (!local) {
      return [];
    }
    return [
      {
        browser: "chrome",
        userDataDir: join(local, "Google", "Chrome", "User Data"),
      },
      {
        browser: "chromium",
        userDataDir: join(local, "Chromium", "User Data"),
      },
    ];
  }
  return [];
}

/** Pure parse of Chrome Local State → preferred profile directory name. */
export function preferredRedditProfileFromLocalState(
  parsed: unknown,
): string | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Chrome Local State root is not an object");
  }
  const profile = (parsed as Record<string, unknown>).profile;
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    return null;
  }
  const record = profile as Record<string, unknown>;
  const lastActive = record.last_active_profiles;
  if (Array.isArray(lastActive)) {
    for (const entry of lastActive) {
      if (typeof entry === "string" && entry.trim().length > 0) {
        return entry.trim();
      }
    }
  }
  const lastUsed = record.last_used;
  if (typeof lastUsed === "string" && lastUsed.trim().length > 0) {
    return lastUsed.trim();
  }
  return null;
}

/**
 * Preferred profile first, then Default / Profile N siblings that look like
 * Chrome profile directories (have a Cookies DB).
 */
function listProfilesForUserDataDir(userDataDir: string): string[] {
  if (!existsSync(userDataDir)) {
    return [];
  }
  const preferred = readPreferredProfile(userDataDir);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (name: string | null) => {
    if (name === null || name.trim().length === 0 || seen.has(name)) {
      return;
    }
    const cookiesPath = join(userDataDir, name, "Cookies");
    if (!existsSync(cookiesPath)) {
      return;
    }
    seen.add(name);
    ordered.push(name);
  };

  push(preferred);
  push("Default");

  for (const entry of readdirSync(userDataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "Default" || /^Profile \d+$/i.test(entry.name)) {
      push(entry.name);
    }
  }

  return ordered;
}

function readPreferredProfile(userDataDir: string): string | null {
  const localStatePath = join(userDataDir, "Local State");
  if (!existsSync(localStatePath)) {
    return null;
  }
  try {
    const raw = readFileSync(localStatePath, "utf8");
    return preferredRedditProfileFromLocalState(JSON.parse(raw));
  } catch {
    // Corrupt Local State — skip preferred profile; still list Default / Profile N.
    return null;
  }
}
