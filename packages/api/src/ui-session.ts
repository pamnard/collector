/**
 * App/UI-session surface — not the sole-writer host contract (#363 / #360 / #370).
 *
 * Gate: new methods belong on a {@link CollectorService} domain port **or** on
 * {@link UiSession} — nowhere else.
 */

import type { AppSettings, ItemFile } from "@collector/shared";
import type { DashboardSnapshotPort } from "./service-api.js";
import { DASHBOARD_SNAPSHOT_PORT_KEYS } from "./service-compose.js";

/** Options for streaming thumbnail path resolution (#544). */
export interface UiSessionThumbnailResolveProgressiveOptions {
  onResolved: (id: string, path: string | null) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

export interface UiSessionThumbnailPaths {
  resolveItemThumbnailPath(item: ItemFile): Promise<string | null>;
  resolveItemThumbnailPaths(
    items: ItemFile[],
  ): Promise<Map<string, string | null>>;
  /** Emit each id as soon as resolved; bounded parallel FS work (#544). */
  resolveItemThumbnailPathsProgressive(
    items: ItemFile[],
    options: UiSessionThumbnailResolveProgressiveOptions,
  ): Promise<void>;
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
  "resolveItemThumbnailPathsProgressive",
] as const satisfies readonly (keyof UiSessionThumbnailPaths)[];
