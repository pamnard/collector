/**
 * Service IPC client dialer (#152/#153) — test harness / future LocalAdapter transport.
 * Not used by the Tauri in-process production path.
 *
 * Rejections are always {@link ServiceIpcError} (see `./errors.ts` mapping table).
 */

import { createConnection, type Socket } from "node:net";
import {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  encodeServiceIpcFrame,
  type ServiceIpcErrorResponse,
  type ServiceIpcEvent,
  type ServiceIpcHealthResult,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
} from "./framing.js";
import {
  ServiceIpcError,
  mapNodeIpcErrno,
  serviceIpcError,
} from "./errors.js";

export type { ServiceIpcHealthResult } from "./framing.js";
export type {
  ServiceIpcClient,
  ServiceIpcClientOptions,
  ServiceIpcRequestOptions,
} from "./transport-types.js";

import type {
  ServiceIpcClient,
  ServiceIpcClientOptions,
  ServiceIpcRequestOptions,
} from "./transport-types.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: ServiceIpcError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort: (() => void) | null;
  signal: AbortSignal | null;
};

function clearPending(entry: Pending): void {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry.signal && entry.onAbort) {
    entry.signal.removeEventListener("abort", entry.onAbort);
  }
  entry.onAbort = null;
  entry.signal = null;
}

export async function connectServiceIpc(
  path: string,
  options: ServiceIpcClientOptions = {},
): Promise<ServiceIpcClient> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const defaultRequestTimeoutMs = options.requestTimeoutMs;

  const socket = await new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.destroy();
      reject(
        serviceIpcError({
          layer: "transport",
          code: "timeout",
          message: `IPC connect timed out after ${connectTimeoutMs}ms`,
        }),
      );
    }, connectTimeoutMs);

    const conn = createConnection({ path }, () => {
      clearTimeout(timer);
      resolve(conn);
    });
    conn.once("error", (error) => {
      clearTimeout(timer);
      reject(mapNodeIpcErrno(error as NodeJS.ErrnoException, "connect"));
    });
  });

  const reader = new ServiceIpcFrameReader();
  const pending = new Map<string, Pending>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  let nextId = 1;
  let closed = false;
  let closing = false;

  const failAll = (error: ServiceIpcError) => {
    for (const [id, entry] of pending) {
      clearPending(entry);
      pending.delete(id);
      entry.reject(error);
    }
  };

  socket.on("data", (chunk) => {
    let messages;
    try {
      messages = reader.push(chunk);
    } catch (error) {
      failAll(
        error instanceof ServiceIpcFramingError
          ? serviceIpcError({
              layer: "transport",
              code: "framing",
              message: error.message,
            })
          : serviceIpcError({
              layer: "transport",
              code: "framing",
              message: error instanceof Error ? error.message : String(error),
            }),
      );
      socket.destroy();
      return;
    }

    for (const message of messages) {
      if (message.type === "req") {
        continue;
      }
      if (message.type === "evt") {
        const evt = message as ServiceIpcEvent;
        const handlers = eventHandlers.get(evt.event);
        if (handlers) {
          for (const handler of handlers) {
            handler(evt.payload);
          }
        }
        continue;
      }
      const wait = pending.get(message.id);
      if (!wait) {
        continue;
      }
      clearPending(wait);
      pending.delete(message.id);
      if (message.type === "res") {
        wait.resolve((message as ServiceIpcResponse).result);
      } else {
        wait.reject(
          serviceIpcError((message as ServiceIpcErrorResponse).error),
        );
      }
    }
  });

  socket.on("close", () => {
    closed = true;
    if (closing && pending.size === 0) {
      return;
    }
    failAll(
      serviceIpcError({
        layer: "transport",
        code: "disconnected",
        message: closing
          ? "IPC connection closed by client"
          : "IPC connection closed by peer",
      }),
    );
  });

  socket.on("error", (error) => {
    // Swallow after mapping: Node requires an error listener, and pending
    // requests are failed via failAll; avoid unhandled 'error' emissions.
    failAll(mapNodeIpcErrno(error as NodeJS.ErrnoException, "socket"));
  });

  const request = (
    method: string,
    params?: unknown,
    requestOptions: ServiceIpcRequestOptions = {},
  ): Promise<unknown> => {
    if (closed) {
      return Promise.reject(
        serviceIpcError({
          layer: "transport",
          code: "not_connected",
          message: "IPC client is closed",
        }),
      );
    }

    const signal = requestOptions.signal ?? null;
    if (signal?.aborted) {
      return Promise.reject(
        serviceIpcError({
          layer: "transport",
          code: "cancelled",
          message: "IPC request aborted before send",
        }),
      );
    }

    const id = String(nextId++);
    const frame: ServiceIpcRequest = {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id,
      type: "req",
      method,
      ...(params === undefined ? {} : { params }),
    };

    const timeoutMs =
      requestOptions.timeoutMs !== undefined
        ? requestOptions.timeoutMs
        : defaultRequestTimeoutMs;

    return new Promise<unknown>((resolve, reject) => {
      const entry: Pending = {
        resolve,
        reject,
        timer: null,
        onAbort: null,
        signal,
      };
      pending.set(id, entry);

      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          const current = pending.get(id);
          if (!current) {
            return;
          }
          clearPending(current);
          pending.delete(id);
          current.reject(
            serviceIpcError({
              layer: "transport",
              code: "timeout",
              message: `IPC request timed out after ${timeoutMs}ms (${method})`,
            }),
          );
        }, timeoutMs);
      }

      if (signal) {
        entry.onAbort = () => {
          const current = pending.get(id);
          if (!current) {
            return;
          }
          clearPending(current);
          pending.delete(id);
          current.reject(
            serviceIpcError({
              layer: "transport",
              code: "cancelled",
              message: `IPC request cancelled (${method})`,
            }),
          );
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
        if (signal.aborted) {
          entry.onAbort();
          return;
        }
      }

      socket.write(encodeServiceIpcFrame(frame), (error) => {
        if (!error) {
          return;
        }
        const current = pending.get(id);
        if (!current) {
          return;
        }
        clearPending(current);
        pending.delete(id);
        current.reject(
          mapNodeIpcErrno(error as NodeJS.ErrnoException, "socket"),
        );
      });
    });
  };

  return {
    request,
    async ping(requestOptions) {
      return (await request("ping", undefined, requestOptions)) as {
        ok: true;
        pong: true;
      };
    },
    async health(requestOptions) {
      return (await request(
        "health",
        undefined,
        requestOptions,
      )) as ServiceIpcHealthResult;
    },
    onEvent(event, handler) {
      let set = eventHandlers.get(event);
      if (!set) {
        set = new Set();
        eventHandlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
        if (set!.size === 0) {
          eventHandlers.delete(event);
        }
      };
    },
    async close() {
      if (closed) {
        return;
      }
      closing = true;
      closed = true;
      eventHandlers.clear();
      await new Promise<void>((resolve) => {
        socket.end(() => resolve());
      });
      socket.destroy();
    },
  };
}

export { ServiceIpcError };
