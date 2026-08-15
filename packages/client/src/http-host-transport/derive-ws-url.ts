import { deriveWsEventsUrl as deriveWsEventsUrlShared } from "@collector/shared";
import { hostWireError } from "@collector/service/wire";

export function deriveWsEventsUrl(baseUrl: string): string {
  try {
    return deriveWsEventsUrlShared(baseUrl);
  } catch (error) {
    throw hostWireError({
      layer: "transport",
      code: "not_connected",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
