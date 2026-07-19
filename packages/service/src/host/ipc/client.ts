/**
 * Service IPC client dialer (#152) — test harness / future LocalAdapter transport.
 * Not used by the Tauri in-process production path.
 */

import { createConnection, type Socket } from "node:net";
import type { CollectorApiError } from "@collector/api";
import {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  encodeServiceIpcFrame,
  type ServiceIpcErrorResponse,
  type ServiceIpcHealthResult,
  type ServiceIpcMethod,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
} from "./framing.js";

export type { ServiceIpcHealthResult } from "./framing.js";

export interface ServiceIpcClient {
  request(method: ServiceIpcMethod, params?: unknown): Promise<unknown>;
  ping(): Promise<{ ok: true; pong: true }>;
  health(): Promise<ServiceIpcHealthResult>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function toError(error: CollectorApiError): Error {
  return Object.assign(new Error(error.message), {
    collectorError: error,
    code: error.code,
  });
}

export async function connectServiceIpc(
  path: string,
  options: { connectTimeoutMs?: number } = {},
): Promise<ServiceIpcClient> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 5_000;
  const socket = await new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.destroy();
      reject(
        toError({
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
      reject(error);
    });
  });

  const reader = new ServiceIpcFrameReader();
  const pending = new Map<string, Pending>();
  let nextId = 1;
  let closed = false;

  const failAll = (error: Error) => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  };

  socket.on("data", (chunk) => {
    let messages;
    try {
      messages = reader.push(chunk);
    } catch (error) {
      failAll(
        error instanceof ServiceIpcFramingError
          ? toError({
              layer: "transport",
              code: "framing",
              message: error.message,
            })
          : error instanceof Error
            ? error
            : new Error(String(error)),
      );
      socket.destroy();
      return;
    }

    for (const message of messages) {
      if (message.type === "req") {
        continue;
      }
      const wait = pending.get(message.id);
      if (!wait) {
        continue;
      }
      pending.delete(message.id);
      if (message.type === "res") {
        wait.resolve((message as ServiceIpcResponse).result);
      } else {
        wait.reject(toError((message as ServiceIpcErrorResponse).error));
      }
    }
  });

  socket.on("close", () => {
    closed = true;
    failAll(
      toError({
        layer: "transport",
        code: "disconnected",
        message: "IPC connection closed",
      }),
    );
  });

  socket.on("error", (error) => {
    failAll(error);
  });

  const request = (method: ServiceIpcMethod, params?: unknown): Promise<unknown> => {
    if (closed) {
      return Promise.reject(
        toError({
          layer: "transport",
          code: "not_connected",
          message: "IPC client is closed",
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

    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.write(encodeServiceIpcFrame(frame), (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  };

  return {
    request,
    async ping() {
      return (await request("ping")) as { ok: true; pong: true };
    },
    async health() {
      return (await request("health")) as ServiceIpcHealthResult;
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await new Promise<void>((resolve) => {
        socket.end(() => resolve());
      });
      socket.destroy();
    },
  };
}
