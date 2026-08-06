/**
 * HTTP host transport + CollectorService (#551).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SERVICE_IPC_EVENTS,
  startServiceHost,
} from "@collector/service/host";
import { defaultServiceIpcTokenPath } from "@collector/service/host";
import {
  createHttpCollectorService,
  createHttpHostTransport,
} from "./http-collector-client.js";

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
      defaultServiceIpcTokenPath(dataDir),
      "utf8",
    ).trim();
    return { host, token, dataDir };
  }

  it("pings, health, and RPC over HTTP", async () => {
    const { host, token, dataDir } = await startHost();
    const transport = await createHttpHostTransport({
      baseUrl: host.baseUrl,
      token,
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
        transport.onEvent(SERVICE_IPC_EVENTS.appSettings, (payload) => {
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

  it("fails loud on wrong token", async () => {
    const { host } = await startHost();
    try {
      await expect(
        createHttpHostTransport({
          baseUrl: host.baseUrl,
          token: "definitely-wrong",
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
});
