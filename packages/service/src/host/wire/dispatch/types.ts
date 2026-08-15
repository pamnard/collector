import type { ServiceDomainRuntime } from "../../domain-runtime.js";

export type DomainDispatchEntry = {
  handle: (
    runtime: ServiceDomainRuntime,
    params: unknown,
  ) => Promise<unknown>;
};
