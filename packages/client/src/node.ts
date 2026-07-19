/**
 * Node-only Collector IPC dialer (#154/#240).
 * Use from smokes/CLI — not from the Vite UI bundle.
 */

export {
  connectCollectorIpcClient,
  createCollectorIpcClient,
  type CollectorIpcClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client-node.js";
