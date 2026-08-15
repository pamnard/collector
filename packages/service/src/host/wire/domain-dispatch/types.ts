import type { ServiceDomainRuntime } from "../../domain-runtime.js";
import type { DomainWireMethod } from "../domain-methods.js";

export type DomainDispatchEntry = {
  handle: (
    runtime: ServiceDomainRuntime,
    params: unknown,
  ) => Promise<unknown>;
};

/** Partial group of wire methods for one domain module. */
export type DomainDispatchGroup = Partial<
  Record<DomainWireMethod, DomainDispatchEntry>
>;
