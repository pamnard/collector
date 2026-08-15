import type { HostWireClient } from "@collector/service/wire";

/** Neutral name for the domain host transport contract (#551). */
export type CollectorHostTransport = HostWireClient;

export type HttpHostTransportOptions = {
  baseUrl: string;
  token: string;
  /** Override WS events URL; default derived from baseUrl + `/api/events`. */
  wsEventsUrl?: string;
  /**
   * When false, skip events WebSocket and dial via HTTP health (#621).
   * Default true (UI / existing callers).
   */
  enableEvents?: boolean;
  /** WS auth / open deadline, or HTTP health dial when events off (default 5000). */
  connectTimeoutMs?: number;
  /** Default per-request timeout when options omit timeoutMs. */
  requestTimeoutMs?: number;
};

/** Shared deps for HTTP domain method builders. */
export type HttpMethodContext = {
  baseUrl: string;
  bearer: string;
  defaultRequestTimeoutMs: number | undefined;
  assertOpen: () => void;
};
