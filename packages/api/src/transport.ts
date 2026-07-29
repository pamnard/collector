/**
 * Thin transport helpers for the shared service contract (#364).
 */

import type { CollectorApiError } from "./errors.js";
import type { Subscription } from "./service-api.js";

/** Wrap a bare teardown callback as {@link Subscription}. */
export function subscriptionFromTeardown(unsubscribe: () => void): Subscription {
  const sub = (() => {
    unsubscribe();
  }) as Subscription;
  sub.unsubscribe = unsubscribe;
  return sub;
}

/** Coerce unknown thrown/rejected values into {@link CollectorApiError}. */
export function asCollectorApiError(error: unknown): CollectorApiError {
  if (
    error !== null &&
    typeof error === "object" &&
    "layer" in error &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const layer = (error as { layer: unknown }).layer;
    if (
      layer === "transport" ||
      layer === "validation" ||
      layer === "domain" ||
      layer === "auth"
    ) {
      return error as CollectorApiError;
    }
  }
  return {
    layer: "domain",
    code: "failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
