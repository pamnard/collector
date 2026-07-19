/**
 * @collector/client — IPC client skeleton matching CollectorServiceApi (#154).
 * Not used by the Tauri in-process production path.
 */

export {
  createCollectorIpcClient,
  connectCollectorIpcClient,
  type CollectorIpcClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";
