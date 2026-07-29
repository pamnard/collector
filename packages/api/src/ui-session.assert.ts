/**
 * Compile-time smoke for #363 UiSession boundary.
 * Types only — erased by tsc; no runtime behavior.
 */
import type { CollectorService, CollectorServiceApi } from "./service-api.js";
import type {
  UiSession,
  UiSessionSettingsSync,
  UiSessionThumbnailPaths,
} from "./ui-session.js";
import type { toUiSession } from "./ui-session.js";
import type { DashboardSnapshotPort } from "./service-api.js";

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

type _ToUiSessionOk = Expect<Equal<ReturnType<typeof toUiSession>, UiSession>>;

type _SnapshotAssignable = Expect<
  UiSession["snapshot"] extends DashboardSnapshotPort ? true : false
>;

type _SettingsSyncAssignable = Expect<
  UiSession["settingsSync"] extends UiSessionSettingsSync ? true : false
>;

type _ThumbnailsAssignable = Expect<
  UiSession["thumbnails"] extends UiSessionThumbnailPaths ? true : false
>;

type _FlatHasUiSlices = Expect<
  CollectorServiceApi extends UiSessionSettingsSync &
    UiSessionThumbnailPaths &
    DashboardSnapshotPort
    ? true
    : false
>;

type _Asserts = [
  _CollectorServiceHasNoSnapshot,
  _UiSessionKeys,
  _ToUiSessionOk,
  _SnapshotAssignable,
  _SettingsSyncAssignable,
  _ThumbnailsAssignable,
  _FlatHasUiSlices,
];

export type UiSessionAsserts = _Asserts;
