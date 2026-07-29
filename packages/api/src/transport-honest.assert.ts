/**
 * Compile-time smoke for #364 transport-honest contract.
 * Types only — erased by tsc.
 */
import type { AttachMediaFileInput, BinaryPayload } from "./domain.js";
import type { CollectorApiError } from "./errors.js";
import type {
  DashboardItemIdsResult,
  DashboardLoadHandlers,
  FoldersPort,
  IndexPort,
  ItemsPort,
  ServiceSubscribeHandlers,
  SettingsPort,
  Subscription,
  TagsPort,
} from "./service-api.js";
import type {
  asCollectorApiError,
  subscriptionFromTeardown,
} from "./transport.js";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _BinaryKeys = Expect<Equal<keyof BinaryPayload, "name" | "bytes">>;
type _AttachIsBinary = Expect<Equal<AttachMediaFileInput, BinaryPayload>>;

type _SubscribeTags = Expect<
  Equal<ReturnType<TagsPort["subscribeTags"]>, Subscription>
>;
type _SubscribeFolders = Expect<
  Equal<ReturnType<FoldersPort["subscribeFolderTree"]>, Subscription>
>;
type _SubscribeIndex = Expect<
  Equal<ReturnType<IndexPort["subscribeVaultIndexSyncStatus"]>, Subscription>
>;
type _SubscribeSettings = Expect<
  Equal<ReturnType<SettingsPort["subscribeAppSettings"]>, Subscription>
>;
type _SubscribeDashboard = Expect<
  Equal<ReturnType<ItemsPort["subscribeDashboardLoad"]>, Subscription>
>;

type OnErrorParam = NonNullable<ServiceSubscribeHandlers["onError"]> extends (
  scope: string,
  error: infer E,
) => void
  ? E
  : never;

type _OnErrorIsApiError = Expect<Equal<OnErrorParam, CollectorApiError>>;

type DashboardOnErrorParam = NonNullable<
  DashboardLoadHandlers["onError"]
> extends (scope: string, error: infer E) => void
  ? E
  : never;

type _DashboardOnErrorIsApiError = Expect<
  Equal<DashboardOnErrorParam, CollectorApiError>
>;

type _IndexSyncOnlyOnDeprecated = Expect<
  "indexSync" extends keyof DashboardItemIdsResult ? true : false
>;

type _Helpers = Expect<
  Equal<ReturnType<typeof subscriptionFromTeardown>, Subscription> &
    Equal<ReturnType<typeof asCollectorApiError>, CollectorApiError>
>;

type _Asserts = [
  _BinaryKeys,
  _AttachIsBinary,
  _SubscribeTags,
  _SubscribeFolders,
  _SubscribeIndex,
  _SubscribeSettings,
  _SubscribeDashboard,
  _OnErrorIsApiError,
  _DashboardOnErrorIsApiError,
  _IndexSyncOnlyOnDeprecated,
  _Helpers,
];

export type TransportHonestAsserts = _Asserts;
