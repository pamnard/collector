/**
 * Browser-safe host wire surface for UI / Vite (#240).
 * Do not add `node:*` imports here.
 */

export {
  SERVICE_HOST_PROTOCOL_VERSION,
  SERVICE_HOST_EVENTS,
  type ServiceHostHealthResult,
} from "./host/wire/framing.js";

export type {
  HostWireClient,
  HostWireClientOptions,
  HostWireRequestOptions,
} from "./host/wire/transport-types.js";

export {
  HostWireError,
  getCollectorApiError,
  isHostWireError,
  hostWireError,
} from "./host/wire/errors.js";
