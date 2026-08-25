/**
 * App/UI-session surface — not the sole-writer host contract (#363 / #360 / #370).
 *
 * Gate: new methods belong on a {@link CollectorService} domain port **or** on
 * {@link UiSession} — nowhere else.
 */

import type { AppSettings, ItemFile } from "@collector/shared";
import type { DashboardSnapshotPort } from "./service-api.js";
import { DASHBOARD_SNAPSHOT_PORT_KEYS } from "./service-compose.js";

/** Pixel size of an on-disk cover when path is non-null (cover.size.json / sharp backfill). */
export type ItemThumbnailPixelSize = {
  width: number;
  height: number;
};

/** Path + size from host thumbnail resolve. */
export type ItemThumbnailResolved = {
  path: string | null;
  /** null iff path is null; positive pixels when path is set. */
  size: ItemThumbnailPixelSize | null;
};

/** Positive WxH from wire/snapshot fields; otherwise null. */
export function positiveThumbnailPixelSize(
  width: unknown,
  height: unknown,
): ItemThumbnailPixelSize | null {
  if (
    typeof width === "number" &&
    width > 0 &&
    typeof height === "number" &&
    height > 0
  ) {
    return { width, height };
  }
  return null;
}

/** Options for streaming thumbnail path resolution (#544). */
export interface UiSessionThumbnailResolveProgressiveOptions {
  onResolved: (
    id: string,
    path: string | null,
    size: ItemThumbnailPixelSize | null,
  ) => void;
  signal?: AbortSignal;
  concurrency?: number;
}

/** Chosen detail-hero file and whether it is image or video. */
export type ItemHeroMediaKind = "image" | "video";

export interface ItemHeroMedia {
  kind: ItemHeroMediaKind;
  filePath: string;
  displayPath: string | null;
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
  resolveItemHeroMedia(item: ItemFile): Promise<ItemHeroMedia | null>;
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
  "resolveItemHeroMedia",
] as const satisfies readonly (keyof UiSessionThumbnailPaths)[];
