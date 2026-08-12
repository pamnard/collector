/**
 * HTTP host transport + CollectorService (#551).
 */

import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVICE_HOST_EVENTS,
  startServiceHost,
} from "@collector/service/host";
import { defaultServiceHostTokenPath } from "@collector/service/host";
import {
  createHttpCollectorService,
  createHttpHostTransport,
} from "./http-collector-client.js";

/** Minimal HTTP host for durable-transport tests (fixed token, no WS). */
async function listenFixedHost(
  token: string,
  port = 0,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const auth = req.headers.authorization;
    const authorized = auth === `Bearer ${token}`;

    if (req.method === "GET" && url.pathname === "/ping") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, pong: true }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      if (!authorized) {
        res.writeHead(401);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          status: "healthy",
          open: true,
          healthy: true,
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/rpc") {
      if (!authorized) {
        res.writeHead(401);
        res.end();
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as {
          id?: string;
          method?: string;
          params?: unknown;
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: parsed.id,
            result: parsed.params ?? null,
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("HTTP host transport (#551)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function startHost() {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-http-client-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    const token = readFileSync(
      defaultServiceHostTokenPath(dataDir),
      "utf8",
    ).trim();
    return { host, token, dataDir };
  }

  it.each([
    { label: "with events WS", enableEvents: true as const },
    { label: "HTTP-only (#621)", enableEvents: false as const },
  ])("pings, health, and RPC over HTTP $label", async ({ enableEvents }) => {
    const { host, token, dataDir } = await startHost();
    const transport = await createHttpHostTransport({
      baseUrl: host.baseUrl,
      token,
      enableEvents,
      connectTimeoutMs: 2_000,
    });
    try {
      expect(await transport.ping()).toEqual({ ok: true, pong: true });
      expect(await transport.health()).toMatchObject({ healthy: true });
      expect(await transport.request("getDataDirectory")).toBe(dataDir);
    } finally {
      await transport.close();
      await host.close();
    }
  });

  it("receives appSettings push over WS", async () => {
    const { host, token } = await startHost();
    const transport = await createHttpHostTransport({
      baseUrl: host.baseUrl,
      token,
      wsEventsUrl: host.wsEventsUrl,
    });
    try {
      const got = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("appSettings timeout")),
          5_000,
        );
        transport.onEvent(SERVICE_HOST_EVENTS.appSettings, (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });
      await transport.request("updateAppSettings", {
        patch: { locale: "en" },
      });
      expect(await got).toBeTruthy();
    } finally {
      await transport.close();
      await host.close();
    }
  });

  it("createHttpCollectorService queries items", async () => {
    const { host, token } = await startHost();
    const service = await createHttpCollectorService(host.baseUrl, token);
    try {
      const page = await service.items.queryIndex("all", undefined, {
        limit: 10,
        offset: 0,
      });
      expect(typeof page.total).toBe("number");
      expect(Array.isArray(page.ids)).toBe(true);
    } finally {
      await host.close();
    }
  });

  it.each([
    { label: "with events WS", enableEvents: true as const },
    { label: "HTTP-only (#621)", enableEvents: false as const },
  ])("fails loud on wrong token $label", async ({ enableEvents }) => {
    const { host } = await startHost();
    try {
      await expect(
        createHttpHostTransport({
          baseUrl: host.baseUrl,
          token: "definitely-wrong",
          enableEvents,
          connectTimeoutMs: 2_000,
        }),
      ).rejects.toMatchObject({
        layer: "auth",
        code: "auth_failed",
      });
    } finally {
      await host.close();
    }
  });

  it("enableEvents false: survives host restart; close() still gates (#621)", async () => {
    const token = "durable-mcp-test-token";
    const { baseUrl, close: stop } = await listenFixedHost(token);
    const transport = await createHttpHostTransport({
      baseUrl,
      token,
      enableEvents: false,
      connectTimeoutMs: 2_000,
    });
    try {
      expect(await transport.health()).toMatchObject({ healthy: true });
      expect(await transport.request("echo", { n: 1 })).toEqual({ n: 1 });

      await stop();
      await expect(transport.health()).rejects.toBeTruthy();

      const restarted = await listenFixedHost(token, new URL(baseUrl).port);
      try {
        expect(await transport.health()).toMatchObject({ healthy: true });
        expect(await transport.request("echo", { n: 2 })).toEqual({ n: 2 });
      } finally {
        await restarted.close();
      }

      await transport.close();
      await expect(transport.health()).rejects.toMatchObject({
        layer: "transport",
        code: "not_connected",
        message: "HTTP host transport is closed",
      });
    } finally {
      await transport.close();
    }
  });
});
