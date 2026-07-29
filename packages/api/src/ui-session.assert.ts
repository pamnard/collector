/**
 * Compile-time smoke for #363 UiSession boundary.
 * Types only — erased by tsc; no runtime behavior.
 */
import type { CollectorService, DashboardSnapshotPort } from "./service-api.js";
import type {
  UiSession,
  UiSessionSettingsSync,
  UiSessionThumbnailPaths,
} from "./ui-session.js";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _CollectorServiceHasNoSnapshot = Expect<
  Equal<keyof CollectorService & "snapshot", never>
>;

type _UiSessionKeys = Expect<
  Equal<keyof UiSession, "snapshot" | "settingsSync" | "thumbnails">
>;

type _SnapshotAssignable = Expect<
  UiSession["snapshot"] extends DashboardSnapshotPort ? true : false
>;

type _SettingsSyncAssignable = Expect<
  UiSession["settingsSync"] extends UiSessionSettingsSync ? true : false
>;

type _ThumbnailsAssignable = Expect<
  UiSession["thumbnails"] extends UiSessionThumbnailPaths ? true : false
>;

type _Asserts = [
  _CollectorServiceHasNoSnapshot,
  _UiSessionKeys,
  _SnapshotAssignable,
  _SettingsSyncAssignable,
  _ThumbnailsAssignable,
];

export type UiSessionAsserts = _Asserts;
