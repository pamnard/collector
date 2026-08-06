/**
 * Service host IPC listener (#152/#153/#336): Unix socket / Windows named pipe.
 *
 * Private bus: peers must pass an `auth` handshake with the host token before
 * any other request or event traffic. Public contact is only via explicitly
 * published surfaces (MCP today). Handler failures map to wire
 * `CollectorApiError` shapes (see `./errors.ts`).
 */

import { unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import type { CollectorApiError } from "@collector/api";
import {
  SERVICE_IPC_AUTH_METHOD,
  extractAuthToken,
  tokensEqual,
} from "./auth.js";
import {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  assertProtocolVersion,
  encodeServiceIpcFrame,
  type ServiceIpcErrorResponse,
  type ServiceIpcEvent,
  type ServiceIpcHealthResult,
  type ServiceIpcMessage,
  type ServiceIpcRequest,
  type ServiceIpcResponse,
} from "./framing.js";
import { mapHandlerThrownToApiError, serviceIpcError } from "./errors.js";
import { defaultServiceIpcPath, isWindowsNamedPipePath } from "./paths.js";

export type { ServiceIpcHealthResult } from "./framing.js";

export interface ServiceIpcHandler {
  ping: () =>
    | { ok: true; pong: true }
    | Promise<{ ok: true; pong: true }>;
  health: () => ServiceIpcHealthResult | Promise<ServiceIpcHealthResult>;
  /**
   * Domain dispatch. Return `undefined` to fall through to unknown_method.
   */
  request?: (
    method: string,
    params?: unknown,
  ) => Promise<unknown | undefined>;
}

export interface ServiceIpcServer {
  path: string;
  /** Push an event frame to every authenticated connected client (#163/#336). */
  broadcastEvent: (event: string, payload: unknown) => void;
  close: () => Promise<void>;
}

type SocketState = {
  socket: Socket;
  authenticated: boolean;
};

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

async function handleRequest(
  message: ServiceIpcRequest,
  handler: ServiceIpcHandler,
): Promise<ServiceIpcResponse | ServiceIpcErrorResponse> {
  assertProtocolVersion(message.v);

  const method = String(message.method);
  if (method === "ping") {
    return {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: message.id,
      type: "res",
      result: await handler.ping(),
    };
  }
  if (method === "health") {
    return {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: message.id,
      type: "res",
      result: await handler.health(),
    };
  }

  if (handler.request) {
    const result = await handler.request(method, message.params);
    if (result !== undefined) {
      return {
        v: SERVICE_IPC_PROTOCOL_VERSION,
        id: message.id,
        type: "res",
        result,
      };
    }
  }

  return errorResponse(message.id, {
    layer: "validation",
    code: "unknown_method",
    message: `unknown method: ${method}`,
  });
}

function writeMessage(socket: Socket, message: ServiceIpcMessage): void {
  if (socket.destroyed) {
    return;
  }
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

function handleAuthRequest(
  message: ServiceIpcRequest,
  expectedToken: string,
  state: SocketState,
): ServiceIpcResponse | ServiceIpcErrorResponse {
  assertProtocolVersion(message.v);
  const provided = extractAuthToken(message.params);
  if (provided === null || !tokensEqual(expectedToken, provided)) {
    return errorResponse(message.id, {
      layer: "auth",
      code: "auth_failed",
      message: "IPC authentication failed",
    });
  }
  state.authenticated = true;
  return {
    v: SERVICE_IPC_PROTOCOL_VERSION,
    id: message.id,
    type: "res",
    result: { ok: true },
  };
}

export async function startServiceIpcServer(
  options: {
    path?: string;
    dataDir: string;
    /** Shared secret; peers must `auth` with this token before other methods. */
    token: string;
    handler: ServiceIpcHandler;
  },
): Promise<ServiceIpcServer> {
  const path = options.path ?? defaultServiceIpcPath(options.dataDir);
  await removeStaleUnixSocket(path);

  const sockets = new Set<SocketState>();
  const server: Server = createServer((socket) => {
    const state: SocketState = { socket, authenticated: false };
    sockets.add(state);
    const reader = new ServiceIpcFrameReader();
    let queue: Promise<void> = Promise.resolve();

    socket.on("data", (chunk) => {
      queue = queue.then(async () => {
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
            if (!state.authenticated) {
              if (String(message.method) === SERVICE_IPC_AUTH_METHOD) {
                const response = handleAuthRequest(
                  message,
                  options.token,
                  state,
                );
                writeMessage(socket, response);
                if (response.type === "err") {
                  socket.destroy();
                }
                continue;
              }
              writeMessage(
                socket,
                errorResponse(message.id, {
                  layer: "auth",
                  code: "auth_required",
                  message: "IPC authentication required before other methods",
                }),
              );
              socket.destroy();
              continue;
            }

            if (String(message.method) === SERVICE_IPC_AUTH_METHOD) {
              writeMessage(
                socket,
                handleAuthRequest(message, options.token, state),
              );
              continue;
            }

            writeMessage(
              socket,
              await handleRequest(message, options.handler),
            );
          } catch (error) {
            writeMessage(
              socket,
              errorResponse(message.id, mapHandlerThrownToApiError(error)),
            );
          }
        }
      });
    });

    socket.on("close", () => {
      sockets.delete(state);
    });
    socket.on("error", () => {
      sockets.delete(state);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });

  let closed = false;
  return {
    path,
    broadcastEvent(event: string, payload: unknown) {
      const message: ServiceIpcEvent = {
        v: SERVICE_IPC_PROTOCOL_VERSION,
        id: "evt",
        type: "evt",
        event,
        payload,
      };
      for (const state of sockets) {
        if (!state.authenticated) {
          continue;
        }
        writeMessage(state.socket, message);
      }
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const state of sockets) {
        state.socket.destroy();
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await removeStaleUnixSocket(path);
    },
  };
}

export { serviceIpcError };
