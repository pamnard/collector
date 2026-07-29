/**
 * App/UI-session surface — not the sole-writer host contract (#363 / #360).
 *
 * Gate: new methods belong on a {@link CollectorService} domain port **or** on
 * {@link UiSession} — nowhere else.
 */

import type { AppSettings, ItemFile } from "@collector/shared";
import type {
  CollectorServiceApi,
  DashboardSnapshotPort,
} from "./service-api.js";
import { DASHBOARD_SNAPSHOT_PORT_KEYS } from "./service-compose.js";

export interface UiSessionThumbnailPaths {
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
}

export interface UiSessionSettingsSync {
  /** In-process only; external clients use SettingsPort async + subscribe. */
  getAppSettingsSync(): AppSettings | null;
}

/**
 * UI-only concerns that must not live on the long-lived host service contract.
 * Host {@link CollectorService} stays domain ports only.
 */
export interface UiSession {
  snapshot: DashboardSnapshotPort;
  settingsSync: UiSessionSettingsSync;
  thumbnails: UiSessionThumbnailPaths;
}

export const UI_SESSION_SNAPSHOT_KEYS = DASHBOARD_SNAPSHOT_PORT_KEYS;

export const UI_SESSION_SETTINGS_SYNC_KEYS = [
  "getAppSettingsSync",
] as const satisfies readonly (keyof UiSessionSettingsSync)[];

export const UI_SESSION_THUMBNAIL_KEYS = [
  "resolveItemThumbnailPath",
  "resolveItemThumbnailPaths",
] as const satisfies readonly (keyof UiSessionThumbnailPaths)[];

function pickBound<T extends object, const K extends readonly (keyof T)[]>(
  source: T,
  keys: K,
): Pick<T, K[number]> {
  const out = {} as Pick<T, K[number]>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "function") {
      (out as Record<string, unknown>)[key as string] = (
        value as (...args: unknown[]) => unknown
      ).bind(source);
    } else {
      (out as Record<string, unknown>)[key as string] = value;
    }
  }
  return out;
}

/** Lift UI-only slices off a flat {@link CollectorServiceApi} into {@link UiSession}. */
export function toUiSession(flat: CollectorServiceApi): UiSession {
  return {
    snapshot: pickBound(flat, UI_SESSION_SNAPSHOT_KEYS),
    settingsSync: pickBound(flat, UI_SESSION_SETTINGS_SYNC_KEYS),
    thumbnails: pickBound(flat, UI_SESSION_THUMBNAIL_KEYS),
  };
}
