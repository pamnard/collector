/**
 * Browser-safe domain host transport types (#240 / #551).
 * No Node runtime imports — usable from Vite/Tauri UI bundles.
 */

import type { ServiceHostHealthResult } from "./framing.js";

export type { ServiceHostHealthResult };

export interface HostWireRequestOptions {
  /** Per-request deadline; omit for no timeout. */
  timeoutMs?: number;
  /** Abort in-flight request → transport `cancelled`. */
  signal?: AbortSignal;
}

export interface HostWireClientOptions {
  /** Dial deadline (default 5000). */
  connectTimeoutMs?: number;
  /** Default per-request timeout when `request` options omit `timeoutMs`. */
  requestTimeoutMs?: number;
  /**
   * Explicit host handshake token (#336). When omitted, resolved from
   * `tokenFile` / `COLLECTOR_HOST_TOKEN` / `dataDir` token file / sock sibling.
   */
  token?: string;
  /** Read token from this path instead of the default dataDir file. */
  tokenFile?: string;
  /** Profile dataDir used to locate `collector-service.host-token`. */
  dataDir?: string;
}

/**
 * Low-level transport to the domain host (#551).
 * HTTP+WS browser dial and legacy socket dial both implement this shape.
 */
export interface CollectorHostTransport {
  request(
    method: string,
    params?: unknown,
    options?: HostWireRequestOptions,
  ): Promise<unknown>;
  ping(options?: HostWireRequestOptions): Promise<{ ok: true; pong: true }>;
  health(options?: HostWireRequestOptions): Promise<ServiceHostHealthResult>;
  /** Subscribe to host→client push events. Returns unsubscribe. */
  onEvent(event: string, handler: (payload: unknown) => void): () => void;
  close(): Promise<void>;
}

/** Legacy dial alias — same shape as {@link CollectorHostTransport}. */
export type HostWireClient = CollectorHostTransport;
