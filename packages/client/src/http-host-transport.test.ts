/**
 * Focused unit tests for HTTP host transport error/timeout/closed paths (#718).
 */

import {
  createServer,
  type Server,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { hostWireError } from "@collector/service/wire";
import {
  createHttpHostTransport,
  deriveWsEventsUrl,
  mapHttpTransportError,
} from "./http-host-transport.js";

type RouteHandler = (res: ServerResponse, url: URL) => void;

async function listenMockHost(handler: RouteHandler): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    req.resume();
    req.on("end", () => {
      handler(res, url);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        // Timeout tests leave sockets open; force-drop so close() settles.
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function okHealth(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      status: "healthy",
      open: true,
      healthy: true,
    }),
  );
}

function notFound(res: ServerResponse): void {
  res.writeHead(404);
  res.end();
}

/** Dial-friendly handler: /health succeeds, then delegates other paths. */
function withOkHealth(onPath: RouteHandler): RouteHandler {
  return (res, url) => {
    if (url.pathname === "/health") {
      okHealth(res);
      return;
    }
    onPath(res, url);
  };
}

describe("http-host-transport (#718)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const close of closers.splice(0)) {
      await close();
    }
  });

  async function connectHttpOnly(
    handler: RouteHandler,
    requestTimeoutMs?: number,
  ) {
    const host = await listenMockHost(handler);
    closers.push(host.close);
    const transport = await createHttpHostTransport({
      baseUrl: host.baseUrl,
      token: "test-token",
      enableEvents: false,
      connectTimeoutMs: 2_000,
      requestTimeoutMs,
    });
    closers.push(() => transport.close());
    return transport;
  }

  it("rejects missing token before dial", async () => {
    await expect(
      createHttpHostTransport({
        baseUrl: "http://127.0.0.1:9",
        token: "",
        enableEvents: false,
      }),
    ).rejects.toMatchObject({
      layer: "auth",
      code: "token_missing",
    });
  });

  it("HTTP health dial fails on connection refused", async () => {
    await expect(
      createHttpHostTransport({
        baseUrl: "http://127.0.0.1:1",
        token: "t",
        enableEvents: false,
        connectTimeoutMs: 500,
      }),
    ).rejects.toMatchObject({
      layer: "transport",
      code: "not_connected",
    });
  });

  it("HTTP health dial fails on unexpected status", async () => {
    const host = await listenMockHost((res, url) => {
      if (url.pathname === "/health") {
        res.writeHead(500);
        res.end("boom");
        return;
      }
      notFound(res);
    });
    closers.push(host.close);
    await expect(
      createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: "t",
        enableEvents: false,
        connectTimeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({
      layer: "transport",
      code: "not_connected",
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("HTTP health dial fails on 401", async () => {
    const host = await listenMockHost((res, url) => {
      if (url.pathname === "/health") {
        res.writeHead(401);
        res.end();
        return;
      }
      notFound(res);
    });
    closers.push(host.close);
    await expect(
      createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: "t",
        enableEvents: false,
        connectTimeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({
      layer: "auth",
      code: "auth_failed",
    });
  });

  it("request times out when response never arrives", async () => {
    const transport = await connectHttpOnly(
      withOkHealth((res, url) => {
        if (url.pathname === "/api/rpc") {
          return;
        }
        notFound(res);
      }),
      50,
    );

    await expect(transport.request("echo", {})).rejects.toMatchObject({
      layer: "transport",
      code: "timeout",
      message: expect.stringContaining("timed out after 50ms"),
    });
  });

  it("request cancels when AbortSignal aborts", async () => {
    const transport = await connectHttpOnly(
      withOkHealth((res, url) => {
        if (url.pathname === "/api/rpc") {
          return;
        }
        notFound(res);
      }),
    );

    const controller = new AbortController();
    const pending = transport.request("echo", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      layer: "transport",
      code: "cancelled",
    });
  });

  it("close() gates subsequent request/ping/health", async () => {
    const transport = await connectHttpOnly(withOkHealth(notFound));

    await transport.close();
    const closed = {
      layer: "transport",
      code: "not_connected",
      message: "HTTP host transport is closed",
    };
    await expect(transport.request("echo", {})).rejects.toMatchObject(closed);
    await expect(transport.ping()).rejects.toMatchObject(closed);
    await expect(transport.health()).rejects.toMatchObject(closed);
  });

  it("request maps HTTP 401 and non-OK statuses", async () => {
    let rpcStatus = 401;
    const transport = await connectHttpOnly(
      withOkHealth((res, url) => {
        if (url.pathname === "/api/rpc") {
          res.writeHead(rpcStatus);
          res.end("nope");
          return;
        }
        notFound(res);
      }),
    );

    await expect(transport.request("echo", {})).rejects.toMatchObject({
      layer: "auth",
      code: "auth_failed",
    });

    rpcStatus = 502;
    await expect(transport.request("echo", {})).rejects.toMatchObject({
      layer: "transport",
      code: "disconnected",
      message: "RPC HTTP 502",
    });
  });

  it("request surfaces RPC body.error", async () => {
    const transport = await connectHttpOnly(
      withOkHealth((res, url) => {
        if (url.pathname === "/api/rpc") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              id: "x",
              error: {
                layer: "domain",
                code: "failed",
                message: "handler blew up",
              },
            }),
          );
          return;
        }
        notFound(res);
      }),
    );

    await expect(transport.request("echo", {})).rejects.toMatchObject({
      layer: "domain",
      code: "failed",
      message: "handler blew up",
    });
  });

  it("ping rejects non-OK and invalid body", async () => {
    let mode: "http-error" | "bad-body" = "http-error";
    const transport = await connectHttpOnly(
      withOkHealth((res, url) => {
        if (url.pathname !== "/ping") {
          notFound(res);
          return;
        }
        if (mode === "http-error") {
          res.writeHead(503);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }),
    );

    await expect(transport.ping()).rejects.toMatchObject({
      layer: "transport",
      code: "disconnected",
      message: "ping HTTP 503",
    });

    mode = "bad-body";
    await expect(transport.ping()).rejects.toMatchObject({
      layer: "transport",
      code: "framing",
      message: "invalid ping response",
    });
  });

  it("health rejects non-OK (except 503) and 401", async () => {
    let mode: "ok-once" | "auth" | "bad" = "ok-once";
    const transport = await connectHttpOnly((res, url) => {
      if (url.pathname !== "/health") {
        notFound(res);
        return;
      }
      if (mode === "ok-once") {
        mode = "auth";
        okHealth(res);
        return;
      }
      if (mode === "auth") {
        mode = "bad";
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(500);
      res.end();
    });

    await expect(transport.health()).rejects.toMatchObject({
      layer: "auth",
      code: "auth_failed",
    });
    await expect(transport.health()).rejects.toMatchObject({
      layer: "transport",
      code: "disconnected",
      message: "health HTTP 500",
    });
  });

  it("mapHttpTransportError preserves HostWireError and wraps others", () => {
    const wire = hostWireError({
      layer: "auth",
      code: "auth_failed",
      message: "nope",
    });
    expect(mapHttpTransportError(wire)).toEqual({
      layer: "auth",
      code: "auth_failed",
      message: "nope",
    });
    expect(mapHttpTransportError(new Error("network down"))).toEqual({
      layer: "transport",
      code: "disconnected",
      message: "network down",
    });
    expect(mapHttpTransportError("plain")).toEqual({
      layer: "transport",
      code: "disconnected",
      message: "plain",
    });
  });

  it("deriveWsEventsUrl maps invalid base URL to not_connected", () => {
    expect(() => deriveWsEventsUrl("not-a-url")).toThrow(
      expect.objectContaining({
        layer: "transport",
        code: "not_connected",
      }),
    );
  });
});
