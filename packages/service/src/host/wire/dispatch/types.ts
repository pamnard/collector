import type { ServiceDomainRuntime } from "../../domain-runtime.js";
import type { DomainWireMethod } from "../domain-methods.js";

export type DomainDispatchEntry = {
  handle: (
    runtime: ServiceDomainRuntime,
    params: unknown,
  ) => Promise<unknown>;
};

export function defineDispatch<K extends DomainWireMethod>(
  entries: Record<K, DomainDispatchEntry>,
): Record<K, DomainDispatchEntry> {
  return entries;
}
