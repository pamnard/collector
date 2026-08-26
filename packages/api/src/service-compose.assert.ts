/**
 * Compile-time smoke for #361 / #370 port composition.
 * Types only — erased by tsc; no runtime behavior.
 */
import type { CollectorService } from "./service-api.js";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _IndexQueryHasNoIndexSync = Expect<
  Equal<
    keyof import("./service-api.js").IndexQueryResult,
    "ids" | "stamps" | "total" | "offset"
  >
>;

type _CollectorServiceKeys = Expect<
  Equal<
    keyof CollectorService,
    | "boot"
    | "items"
    | "tags"
    | "folders"
    | "media"
    | "vaults"
    | "index"
    | "jobs"
    | "settings"
    | "credentials"
    | "syncPlugins"
    | "extract"
    | "telegramSync"
  >
>;

type _Asserts = [_IndexQueryHasNoIndexSync, _CollectorServiceKeys];

export type ServiceComposeAsserts = _Asserts;
