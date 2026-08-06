/**
 * WS /api/events — push-only event fan-out for browser UI (#551).
 * Auth via first text message after connect (browsers cannot set WS headers).
 */

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { tokensEqual } from "../ipc/auth.js";
import { SERVICE_IPC_EVENTS } from "../ipc/framing.js";

export type HostHttpEventName =
  (typeof SERVICE_IPC_EVENTS)[keyof typeof SERVICE_IPC_EVENTS];

type AuthedSocket = {
  socket: WebSocket;
  authenticated: boolean;
};

export type HostHttpEventsHub = {
  /** Attach upgrade handling to the HTTP server for `/api/events`. */
  attach: (server: HttpServer) => void;
  broadcastEvent: (event: string, payload: unknown) => void;
  close: () => Promise<void>;
};

function parseAuthMessage(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const msg = parsed as { type?: unknown; token?: unknown };
  if (msg.type !== "auth") {
    return null;
  }
  return typeof msg.token === "string" && msg.token.length > 0
    ? msg.token
    : null;
}

export function createHostHttpEventsHub(options: {
  expectedToken: string;
  path?: string;
}): HostHttpEventsHub {
  const path = options.path ?? "/api/events";
  const sockets = new Set<AuthedSocket>();
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    const state: AuthedSocket = { socket, authenticated: false };
    sockets.add(state);

    const failAuth = (): void => {
      sockets.delete(state);
      socket.close();
    };

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        failAuth();
        return;
      }
      const text = typeof data === "string" ? data : data.toString("utf8");

      if (!state.authenticated) {
        const token = parseAuthMessage(text);
        if (
          token === null ||
          !tokensEqual(options.expectedToken, token)
        ) {
          failAuth();
          return;
        }
        state.authenticated = true;
        socket.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }

      // Push-only: ignore client messages after auth.
    });

    socket.on("close", () => {
      sockets.delete(state);
    });
    socket.on("error", () => {
      sockets.delete(state);
    });
  });

  return {
    attach(server) {
      server.on("upgrade", (req: IncomingMessage, socket, head) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== path) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      });
    },
    broadcastEvent(event, payload) {
      const frame = JSON.stringify({ type: "evt", event, payload });
      for (const state of sockets) {
        if (
          !state.authenticated ||
          state.socket.readyState !== WebSocket.OPEN
        ) {
          continue;
        }
        state.socket.send(frame);
      }
    },
    async close() {
      for (const state of sockets) {
        state.socket.close();
      }
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export { SERVICE_IPC_EVENTS as HOST_HTTP_EVENTS };
