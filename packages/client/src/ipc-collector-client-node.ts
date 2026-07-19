/**
 * Node dialer for Collector IPC client (#154/#240).
 */

import {
  connectServiceIpc,
  type ServiceIpcClientOptions,
} from "@collector/service/host";
import {
  createCollectorIpcClient,
  type CollectorIpcClient,
  type ServiceIpcHealthResult,
} from "./ipc-collector-client.js";

export {
  createCollectorIpcClient,
  type CollectorIpcClient,
  type ServiceIpcHealthResult,
};

/** Dial the out-of-band service host and return the API-shaped IPC client. */
export async function connectCollectorIpcClient(
  path: string,
  options?: ServiceIpcClientOptions,
): Promise<CollectorIpcClient> {
  const transport = await connectServiceIpc(path, options);
  return createCollectorIpcClient(transport);
}
