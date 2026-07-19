/**
 * Browser-safe IPC surface for UI / Vite (#240).
 * Do not add `node:*` imports here.
 */

export {
  SERVICE_IPC_PROTOCOL_VERSION,
  SERVICE_IPC_EVENTS,
  type ServiceIpcHealthResult,
} from "./host/ipc/framing.js";

export type {
  ServiceIpcClient,
  ServiceIpcClientOptions,
  ServiceIpcRequestOptions,
} from "./host/ipc/transport-types.js";

export {
  ServiceIpcError,
  getCollectorApiError,
  isServiceIpcError,
  serviceIpcError,
} from "./host/ipc/errors.js";
