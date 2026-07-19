/**
 * Service host IPC listener (#152): Unix socket / Windows named pipe.
 */

import { unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import type { CollectorApiError } from "@collector/api";
import {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  assertProtocolVersion,
  encodeServiceIpcFrame,
  type ServiceIpcErrorResponse,
  type ServiceIpcHealthResult,
  type ServiceIpcMessage,
  type ServiceIpcMethod,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
} from "./framing.js";
import { defaultServiceIpcPath, isWindowsNamedPipePath } from "./paths.js";

export type { ServiceIpcHealthResult } from "./framing.js";

export interface ServiceIpcHandler {
  ping: () => { ok: true; pong: true };
  health: () => ServiceIpcHealthResult;
}

export interface ServiceIpcServer {
  path: string;
  close: () => Promise<void>;
}

function errorResponse(
  id: string,
  error: CollectorApiError,
): ServiceIpcErrorResponse {
  return {
    v: SERVICE_IPC_PROTOCOL_VERSION,
    id,
    type: "err",
    error,
  };
}

function handleRequest(
  message: ServiceIpcRequest,
  handler: ServiceIpcHandler,
): ServiceIpcResponse | ServiceIpcErrorResponse {
  assertProtocolVersion(message.v);

  const method = message.method as ServiceIpcMethod;
  if (method === "ping") {
    return {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: message.id,
      type: "res",
      result: handler.ping(),
    };
  }
  if (method === "health") {
    return {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: message.id,
      type: "res",
      result: handler.health(),
    };
  }

  return errorResponse(message.id, {
    layer: "validation",
    code: "unknown_method",
    message: `unknown method: ${String(message.method)}`,
  });
}

function writeMessage(socket: Socket, message: ServiceIpcMessage): void {
  socket.write(encodeServiceIpcFrame(message));
}

async function removeStaleUnixSocket(path: string): Promise<void> {
  if (isWindowsNamedPipePath(path)) {
    return;
  }
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export async function startServiceIpcServer(
  options: {
    path?: string;
    dataDir: string;
    handler: ServiceIpcHandler;
  },
): Promise<ServiceIpcServer> {
  const path = options.path ?? defaultServiceIpcPath(options.dataDir);
  await removeStaleUnixSocket(path);

  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    const reader = new ServiceIpcFrameReader();

    socket.on("data", (chunk) => {
      let messages: ServiceIpcMessage[];
      try {
        messages = reader.push(chunk);
      } catch (error) {
        const framing: CollectorApiError = {
          layer: "transport",
          code: "framing",
          message:
            error instanceof ServiceIpcFramingError
              ? error.message
              : "framing error",
        };
        writeMessage(socket, errorResponse("0", framing));
        socket.destroy();
        return;
      }

      for (const message of messages) {
        if (message.type !== "req") {
          writeMessage(
            socket,
            errorResponse(
              "id" in message && typeof message.id === "string"
                ? message.id
                : "0",
              {
                layer: "validation",
                code: "bad_request",
                message: "server only accepts type=req frames",
              },
            ),
          );
          continue;
        }

        try {
          writeMessage(socket, handleRequest(message, options.handler));
        } catch (error) {
          const collectorError = (error as { collectorError?: CollectorApiError })
            .collectorError;
          writeMessage(
            socket,
            errorResponse(
              message.id,
              collectorError ?? {
                layer: "domain",
                code: "failed",
                message:
                  error instanceof Error ? error.message : String(error),
              },
            ),
          );
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });

  let closed = false;
  return {
    path,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await removeStaleUnixSocket(path);
    },
  };
}
