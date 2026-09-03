/**
 * Pick browser cookies for yt-dlp `--cookies-from-browser` (#317).
 * Prefer last_active_profiles[0] over last_used — the latter may lack YouTube login.
 * COLLECTOR_YT_COOKIES_BROWSER overrides auto-detect (e.g. `chrome:Profile 3`).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CookieBrowserKind = "chrome" | "chromium";

/**
 * Browser argument for yt-dlp, e.g. `chrome:Profile 3`.
 * `null` = no usable Chrome/Chromium profile (extract must fail explicitly).
 */
export function resolveYoutubeCookiesBrowser(): string | null {
  const fromEnv = process.env.COLLECTOR_YT_COOKIES_BROWSER?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  for (const candidate of listCookieBrowserUserDataDirs()) {
    const profile = readPreferredProfile(candidate.userDataDir);
    if (profile === null) {
      // Local State missing/unreadable — try next browser.
      continue;
    }
    return `${candidate.browser}:${profile}`;
  }
  return null;
}

export function listCookieBrowserUserDataDirs(): Array<{
  browser: CookieBrowserKind;
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

/** @deprecated Prefer listCookieBrowserUserDataDirs — kept for older call sites. */
export function chromeUserDataDir(): string | null {
  return listCookieBrowserUserDataDirs()[0]?.userDataDir ?? null;
}

/** Pure parse of Chrome Local State → preferred profile directory name. */
export function preferredProfileFromLocalState(
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

function readPreferredProfile(userDataDir: string): string | null {
  const localStatePath = join(userDataDir, "Local State");
  if (!existsSync(localStatePath)) {
    return null;
  }
  const raw = readFileSync(localStatePath, "utf8");
  return preferredProfileFromLocalState(JSON.parse(raw));
}

/** Profile directory name under the first available browser, or null. */
export function readChromePreferredProfile(): string | null {
  for (const candidate of listCookieBrowserUserDataDirs()) {
    const profile = readPreferredProfile(candidate.userDataDir);
    if (profile !== null) {
      return profile;
    }
  }
  return null;
}
