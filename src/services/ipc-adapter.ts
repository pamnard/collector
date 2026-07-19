/**
 * IPC-backed CollectorClient factory for the UI (#240).
 * Transport is injected (Tauri proxy, mock, etc.) — no Node dialer.
 */

import type { CollectorServiceApi } from "@collector/api";
import {
  createCollectorIpcClient,
  type ServiceIpcClient,
} from "@collector/client";

export type CollectorClient = CollectorServiceApi;

export function createIpcAdapter(transport: ServiceIpcClient): CollectorClient {
  return createCollectorIpcClient(transport);
}
