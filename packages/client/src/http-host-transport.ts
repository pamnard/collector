/**
 * HTTP + WebSocket transport to the domain host (#551).
 * Browser-safe: fetch + WebSocket only (no length-prefixed framing).
 */

import type { CollectorApiError } from "@collector/api";
import { deriveWsEventsUrl as deriveWsEventsUrlShared } from "@collector/shared";
import type { HostWireClient } from "@collector/service/wire";
import {
  getCollectorApiError,
  hostWireError,
} from "@collector/service/wire";
import {
  buildHttpMethods,
  dialHttpHealth,
  withTimeout,
} from "./http-host-methods.js";

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

export function deriveWsEventsUrl(baseUrl: string): string {
  try {
    return deriveWsEventsUrlShared(baseUrl);
  } catch (error) {
    throw hostWireError({
      layer: "transport",
      code: "not_connected",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function wireOnEvent(
  eventHandlers: Map<string, Set<(payload: unknown) => void>>,
): CollectorHostTransport["onEvent"] {
  return (event, handler) => {
    let set = eventHandlers.get(event);
    if (!set) {
      set = new Set();
      eventHandlers.set(event, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
      if (set.size === 0) {
        eventHandlers.delete(event);
      }
    };
  };
}

/**
 * Connect HTTP(+optional WS) transport.
 * Default: resolves after WS auth. With `enableEvents: false`: HTTP health dial only (#621).
 */
export async function createHttpHostTransport(
  options: HttpHostTransportOptions,
): Promise<CollectorHostTransport> {
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const token = options.token;
  if (!token) {
    throw hostWireError({
      layer: "auth",
      code: "token_missing",
      message: "host token required for HTTP transport",
    });
  }
  const enableEvents = options.enableEvents !== false;
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const defaultRequestTimeoutMs = options.requestTimeoutMs;

  let closed = false;
  let ws: WebSocket | undefined;
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();

  if (enableEvents) {
    const wsEventsUrl = options.wsEventsUrl ?? deriveWsEventsUrl(baseUrl);
    ws = new WebSocket(wsEventsUrl);

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          ws!.removeEventListener("open", onOpen);
          ws!.removeEventListener("error", onError);
          ws!.removeEventListener("message", onMessage);
          ws!.removeEventListener("close", onClose);
          reject(error);
        };
        const onOpen = (): void => {
          ws!.removeEventListener("error", onError);
          ws!.send(JSON.stringify({ type: "auth", token }));
        };
        const onError = (): void => {
          fail(
            hostWireError({
              layer: "transport",
              code: "not_connected",
              message: `WebSocket connect failed: ${wsEventsUrl}`,
            }),
          );
        };
        const onClose = (): void => {
          fail(
            hostWireError({
              layer: "auth",
              code: "auth_failed",
              message: "WebSocket authentication failed",
            }),
          );
        };
        const onMessage = (event: MessageEvent): void => {
          let msg: { type?: string };
          try {
            msg = JSON.parse(String(event.data)) as { type?: string };
          } catch {
            fail(
              hostWireError({
                layer: "transport",
                code: "framing",
                message: "invalid WS auth response",
              }),
            );
            return;
          }
          if (msg.type === "auth_ok") {
            if (settled) {
              return;
            }
            settled = true;
            ws!.removeEventListener("message", onMessage);
            ws!.removeEventListener("close", onClose);
            resolve();
          }
        };
        ws!.addEventListener("open", onOpen, { once: true });
        ws!.addEventListener("error", onError, { once: true });
        ws!.addEventListener("close", onClose, { once: true });
        ws!.addEventListener("message", onMessage);
      }),
      connectTimeoutMs,
      "WS auth",
    );

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: { type?: string; event?: string; payload?: unknown };
      try {
        msg = JSON.parse(String(event.data)) as {
          type?: string;
          event?: string;
          payload?: unknown;
        };
      } catch {
        return;
      }
      if (msg.type !== "evt" || typeof msg.event !== "string") {
        return;
      }
      const handlers = eventHandlers.get(msg.event);
      if (!handlers) {
        return;
      }
      for (const handler of handlers) {
        handler(msg.payload);
      }
    });

    ws.addEventListener("close", () => {
      if (!closed) {
        closed = true;
        eventHandlers.clear();
      }
    });
  } else {
    await dialHttpHealth(baseUrl, token, connectTimeoutMs);
  }

  const http = buildHttpMethods({
    baseUrl,
    token,
    defaultRequestTimeoutMs,
    isClosed: () => closed,
  });

  return {
    ...http,
    onEvent: enableEvents ? wireOnEvent(eventHandlers) : () => () => {},
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      eventHandlers.clear();
      if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING)
      ) {
        ws.close();
      }
    },
  };
}

export function mapHttpTransportError(error: unknown): CollectorApiError {
  const existing = getCollectorApiError(error);
  if (existing) {
    return existing;
  }
  return {
    layer: "transport",
    code: "disconnected",
    message: error instanceof Error ? error.message : String(error),
  };
}
