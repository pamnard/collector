/**
 * Browser-safe Service IPC transport types (#240).
 * No Node runtime imports — usable from Vite/Tauri UI bundles.
 */

import type { ServiceIpcHealthResult } from "./framing.js";

export type { ServiceIpcHealthResult };

export interface ServiceIpcRequestOptions {
  /** Per-request deadline; omit for no timeout. */
  timeoutMs?: number;
  /** Abort in-flight request → transport `cancelled`. */
  signal?: AbortSignal;
}

export interface ServiceIpcClientOptions {
  /** Dial deadline (default 5000). */
  connectTimeoutMs?: number;
  /** Default per-request timeout when `request` options omit `timeoutMs`. */
  requestTimeoutMs?: number;
  /**
   * Explicit IPC handshake token (#336). When omitted, resolved from
   * `tokenFile` / `COLLECTOR_IPC_TOKEN` / `dataDir` token file / sock sibling.
   */
  token?: string;
  /** Read token from this path instead of the default dataDir file. */
  tokenFile?: string;
  /** Profile dataDir used to locate `collector-service.ipc-token`. */
  dataDir?: string;
}

/**
 * Low-level framed IPC transport. Node dialer and Tauri proxy both implement this.
 */
export interface ServiceIpcClient {
  request(
    method: string,
    params?: unknown,
    options?: ServiceIpcRequestOptions,
  ): Promise<unknown>;
  ping(options?: ServiceIpcRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: ServiceIpcRequestOptions): Promise<ServiceIpcHealthResult>;
  /** Subscribe to host→client event frames (#163). Returns unsubscribe. */
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  close(): Promise<void>;
}
