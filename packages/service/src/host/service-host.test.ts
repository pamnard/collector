import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_HOST_PORT,
  SERVICE_HOST_READY_PREFIX,
  formatServiceHostReadyLine,
  resolveServiceHostListenPort,
  startServiceHost,
} from "./service-host.js";
import { connectHostWire } from "./wire/client.js";
import { defaultServiceHostTokenPath } from "./wire/auth.js";
import { defaultServiceHostBaseUrlPath } from "./wire/base-url.js";

describe("resolveServiceHostListenPort", () => {
  it("defaults to DEFAULT_SERVICE_HOST_PORT (1421)", () => {
    expect(DEFAULT_SERVICE_HOST_PORT).toBe(1421);
    expect(resolveServiceHostListenPort()).toBe(DEFAULT_SERVICE_HOST_PORT);
    expect(resolveServiceHostListenPort(undefined)).toBe(
      DEFAULT_SERVICE_HOST_PORT,
    );
  });

  it("keeps explicit 0 as ephemeral", () => {
    expect(resolveServiceHostListenPort(0)).toBe(0);
  });

  it("passes through an explicit fixed port", () => {
    expect(resolveServiceHostListenPort(9999)).toBe(9999);
  });
});

describe("startServiceHost", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens index DB and answers ping + health over HTTP and IPC", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-service-host-"));
    dirs.push(dataDir);

    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      expect(host.isHealthy()).toBe(true);
      expect(host.port).toBeGreaterThan(0);
      expect(host.ipcPath).toBeTruthy();
      expect(host.wsEventsUrl).toBe(`${host.baseUrl.replace(/^http/, "ws")}/api/events`);

      const token = readFileSync(
        defaultServiceHostTokenPath(dataDir),
        "utf8",
      ).trim();
      const publishedBaseUrl = readFileSync(
        defaultServiceHostBaseUrlPath(dataDir),
        "utf8",
      ).trim();
      expect(publishedBaseUrl).toBe(host.baseUrl);

      const ping = await fetch(`${host.baseUrl}/ping`);
      expect(ping.status).toBe(200);
      expect(await ping.json()).toEqual({ ok: true, pong: true });

      const healthBare = await fetch(`${host.baseUrl}/health`);
      expect(healthBare.status).toBe(401);

      const health = await fetch(`${host.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        status: "healthy",
        open: true,
        healthy: true,
      });

      const ipc = await connectHostWire(host.ipcPath!, {
        dataDir,
      });
      try {
        expect(await ipc.ping()).toEqual({ ok: true, pong: true });
        expect(await ipc.health()).toMatchObject({ healthy: true });
      } finally {
        await ipc.close();
      }

      const ready = formatServiceHostReadyLine(host);
      expect(ready.startsWith(SERVICE_HOST_READY_PREFIX)).toBe(true);
      expect(JSON.parse(ready.slice(SERVICE_HOST_READY_PREFIX.length))).toEqual({
        host: host.host,
        port: host.port,
        baseUrl: host.baseUrl,
        wsEventsUrl: host.wsEventsUrl,
        ipcPath: host.ipcPath,
        uiDir: null,
        dataDir: host.layout.dataDir,
        configDir: host.layout.configDir,
        indexDbPath: host.layout.indexDbPath,
      });
    } finally {
      await host.close();
    }
    expect(existsSync(defaultServiceHostBaseUrlPath(dataDir))).toBe(false);
    expect(existsSync(defaultServiceHostTokenPath(dataDir))).toBe(false);
  });
});
