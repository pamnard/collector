import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVICE_HOST_READY_PREFIX,
  formatServiceHostReadyLine,
  startServiceHost,
} from "./service-host.js";
import { connectServiceIpc } from "./ipc/client.js";
import { defaultServiceIpcTokenPath } from "./ipc/auth.js";

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
        defaultServiceIpcTokenPath(dataDir),
        "utf8",
      ).trim();

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

      const ipc = await connectServiceIpc(host.ipcPath!, {
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
        dataDir: host.layout.dataDir,
        configDir: host.layout.configDir,
        indexDbPath: host.layout.indexDbPath,
      });
    } finally {
      await host.close();
    }
  });
});
