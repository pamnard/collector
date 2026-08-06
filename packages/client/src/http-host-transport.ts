/**
 * HTTP + WebSocket transport to the domain host (#551).
 * Browser-safe: fetch + WebSocket only (no length-prefixed framing).
 */

import type { CollectorApiError } from "@collector/api";
import type {
  HostWireClient,
  ServiceHostHealthResult,
} from "@collector/service/wire";
import {
  getCollectorApiError,
  hostWireError,
} from "@collector/service/wire";

/** Neutral name for the domain host transport contract (#551). */
export type CollectorHostTransport = HostWireClient;
export type HttpHostTransportOptions = {
  baseUrl: string;
  token: string;
  /** Override WS events URL; default derived from baseUrl + `/api/events`. */
  wsEventsUrl?: string;
  /** WS auth / open deadline (default 5000). */
  connectTimeoutMs?: number;
  /** Default per-request timeout when options omit timeoutMs. */
  requestTimeoutMs?: number;
};

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function deriveWsEventsUrl(baseUrl: string): string {
  const base = trimTrailingSlash(baseUrl);
  if (base.startsWith("https://")) {
    return `${base.replace(/^https:/, "wss:")}/api/events`;
  }
  if (base.startsWith("http://")) {
    return `${base.replace(/^http:/, "ws:")}/api/events`;
  }
  throw hostWireError({
    layer: "transport",
    code: "not_connected",
    message: `baseUrl must be http(s): ${baseUrl}`,
  });
}

function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(
      hostWireError({
        layer: "transport",
        code: "cancelled",
        message: `${label} cancelled`,
      }),
    );
  }
  if (timeoutMs === undefined) {
    if (!signal) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(
          hostWireError({
            layer: "transport",
            code: "cancelled",
            message: `${label} cancelled`,
          }),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        hostWireError({
          layer: "transport",
          code: "timeout",
          message: `${label} timed out after ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        hostWireError({
          layer: "transport",
          code: "cancelled",
          message: `${label} cancelled`,
        }),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Connect HTTP+WS transport. Resolves after WS auth succeeds.
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
  const wsEventsUrl = options.wsEventsUrl ?? deriveWsEventsUrl(baseUrl);
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const defaultRequestTimeoutMs = options.requestTimeoutMs;

  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  let closed = false;

  const ws = new WebSocket(wsEventsUrl);

  await withTimeout(
    new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("close", onClose);
        reject(error);
      };
      const onOpen = (): void => {
        ws.removeEventListener("error", onError);
        ws.send(JSON.stringify({ type: "auth", token }));
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
          ws.removeEventListener("message", onMessage);
          ws.removeEventListener("close", onClose);
          resolve();
        }
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("close", onClose, { once: true });
      ws.addEventListener("message", onMessage);
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

  const authHeaders = (): HeadersInit => ({
    Authorization: `Bearer ${token}`,
  });

  const transport: CollectorHostTransport = {
    async request(method, params, requestOptions) {
      if (closed) {
        throw hostWireError({
          layer: "transport",
          code: "not_connected",
          message: "HTTP host transport is closed",
        });
      }
      const id = nextId();
      const timeoutMs =
        requestOptions?.timeoutMs ?? defaultRequestTimeoutMs;
      const run = (async () => {
        const response = await fetch(`${baseUrl}/api/rpc`, {
          method: "POST",
          headers: {
            ...authHeaders(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ id, method, params }),
          signal: requestOptions?.signal,
        });
        if (response.status === 401) {
          throw hostWireError({
            layer: "auth",
            code: "auth_failed",
            message: "Bearer authentication failed",
          });
        }
        if (!response.ok) {
          throw hostWireError({
            layer: "transport",
            code: "disconnected",
            message: `RPC HTTP ${response.status}`,
          });
        }
        const body = (await response.json()) as {
          id?: unknown;
          result?: unknown;
          error?: CollectorApiError;
        };
        if (body.error) {
          throw hostWireError(body.error);
        }
        return body.result;
      })();
      return withTimeout(run, timeoutMs, `RPC ${method}`, requestOptions?.signal);
    },

    async ping(requestOptions) {
      if (closed) {
        throw hostWireError({
          layer: "transport",
          code: "not_connected",
          message: "HTTP host transport is closed",
        });
      }
      const timeoutMs =
        requestOptions?.timeoutMs ?? defaultRequestTimeoutMs;
      const run = (async () => {
        const response = await fetch(`${baseUrl}/ping`, {
          signal: requestOptions?.signal,
        });
        if (!response.ok) {
          throw hostWireError({
            layer: "transport",
            code: "disconnected",
            message: `ping HTTP ${response.status}`,
          });
        }
        const body = (await response.json()) as { ok?: boolean; pong?: boolean };
        if (!body.pong) {
          throw hostWireError({
            layer: "transport",
            code: "framing",
            message: "invalid ping response",
          });
        }
        return { ok: true as const, pong: true as const };
      })();
      return withTimeout(run, timeoutMs, "ping", requestOptions?.signal);
    },

    async health(requestOptions) {
      if (closed) {
        throw hostWireError({
          layer: "transport",
          code: "not_connected",
          message: "HTTP host transport is closed",
        });
      }
      const timeoutMs =
        requestOptions?.timeoutMs ?? defaultRequestTimeoutMs;
      const run = (async () => {
        const response = await fetch(`${baseUrl}/health`, {
          headers: authHeaders(),
          signal: requestOptions?.signal,
        });
        if (response.status === 401) {
          throw hostWireError({
            layer: "auth",
            code: "auth_failed",
            message: "Bearer authentication failed",
          });
        }
        if (!response.ok && response.status !== 503) {
          throw hostWireError({
            layer: "transport",
            code: "disconnected",
            message: `health HTTP ${response.status}`,
          });
        }
        return (await response.json()) as ServiceHostHealthResult;
      })();
      return withTimeout(run, timeoutMs, "health", requestOptions?.signal);
    },

    onEvent(event, handler) {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
        if (set && set.size === 0) {
          eventHandlers.delete(event);
        }
      };
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      eventHandlers.clear();
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    },
  };

  // Surface unexpected close as disconnect for in-flight nothing — handlers cleared on close().
  ws.addEventListener("close", () => {
    if (!closed) {
      closed = true;
      eventHandlers.clear();
    }
  });

  return transport;
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
