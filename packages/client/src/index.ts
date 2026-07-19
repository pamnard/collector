/**
 * @collector/client — browser-safe IPC CollectorClient factory (#154/#240).
 * Injectable transport only — no Node dialer in this entry.
 */

export {
  createCollectorIpcClient,
  type CollectorIpcClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";

export type {
  ServiceIpcClient,
  ServiceIpcRequestOptions,
} from "@collector/service/ipc";
