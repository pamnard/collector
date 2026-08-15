import type { CollectorApiError } from "@collector/api";
import { getCollectorApiError } from "@collector/service/wire";

export function mapHttpTransportError(error: unknown): CollectorApiError {
  const existing = getCollectorApiError(error);
  if (existing) {
    return existing;
  }
  return {
    layer: "transport",
    code: "disconnected",
    message: error instanceof Error ? error.message : String(error),
  };
}
