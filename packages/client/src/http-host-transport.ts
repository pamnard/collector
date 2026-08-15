/**
 * HTTP + WebSocket transport to the domain host (#551).
 * Browser-safe: fetch + WebSocket only (no length-prefixed framing).
 * Implementation is split by concern under `./http-host-transport/` (#673).
 */

export type {
  CollectorHostTransport,
  HttpHostTransportOptions,
} from "./http-host-transport/types.js";

export { createHttpHostTransport } from "./http-host-transport/create.js";
export { deriveWsEventsUrl } from "./http-host-transport/derive-ws-url.js";
export { mapHttpTransportError } from "./http-host-transport/errors.js";
