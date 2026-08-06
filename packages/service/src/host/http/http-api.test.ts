/**
 * HTTP RPC / events / auth / media surfaces for the domain host (#551 / #553).
 */

import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { vaultsRoot } from "@collector/core";
import { defaultServiceIpcTokenPath } from "../ipc/auth.js";
import {
  formatServiceHostReadyLine,
  SERVICE_HOST_READY_PREFIX,
  startServiceHost,
} from "../service-host.js";

describe("host HTTP RPC + events (#551)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function start() {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-http-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    const token = readFileSync(
      defaultServiceIpcTokenPath(dataDir),
      "utf8",
    ).trim();
    return { host, token, dataDir };
  }

  it("rejects /health without Bearer and accepts with token", async () => {
    const { host, token } = await start();
    try {
      const bare = await fetch(`${host.baseUrl}/health`);
      expect(bare.status).toBe(401);

      const ok = await fetch(`${host.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ healthy: true });
    } finally {
      await host.close();
    }
  });

  it("POST /api/rpc routes through domainDispatch with Bearer", async () => {
    const { host, token, dataDir } = await start();
    try {
      const unauthorized = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "1", method: "getDataDirectory" }),
      });
      expect(unauthorized.status).toBe(401);

      const rpc = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "1", method: "getDataDirectory" }),
      });
      expect(rpc.status).toBe(200);
      const body = (await rpc.json()) as {
        id: string;
        result?: unknown;
        error?: unknown;
      };
      expect(body.id).toBe("1");
      expect(body.error).toBeUndefined();
      expect(body.result).toBe(dataDir);
    } finally {
      await host.close();
    }
  });

  it("returns unknown_method for missing domain methods", async () => {
    const { host, token } = await start();
    try {
      const rpc = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "x", method: "definitelyNotAMethod" }),
      });
      expect(rpc.status).toBe(200);
      const body = (await rpc.json()) as {
        error?: { code?: string };
      };
      expect(body.error?.code).toBe("unknown_method");
    } finally {
      await host.close();
    }
  });

  it("CORS preflight reflects local Vite Origin", async () => {
    const { host } = await start();
    try {
      const res = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://127.0.0.1:1420",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(
        "http://127.0.0.1:1420",
      );
      expect(res.headers.get("access-control-allow-headers")).toMatch(
        /Authorization/i,
      );
      expect(res.headers.get("access-control-allow-methods")).toMatch(/HEAD/i);
    } finally {
      await host.close();
    }
  });

  it("WS /api/events requires auth then fans out appSettings", async () => {
    const { host, token } = await start();
    try {
      const ws = new WebSocket(host.wsEventsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });

      const authOk = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("auth_ok timeout")),
          5_000,
        );
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as { type?: string };
          if (msg.type === "auth_ok") {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      ws.send(JSON.stringify({ type: "auth", token }));
      await authOk;

      const settingsEvent = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("appSettings event timeout")),
          5_000,
        );
        ws.on("message", (data) => {
          const msg = JSON.parse(String(data)) as {
            type?: string;
            event?: string;
            payload?: unknown;
          };
          if (msg.type === "evt" && msg.event === "appSettings") {
            clearTimeout(timer);
            resolve(msg.payload);
          }
        });
      });

      const setRes = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "set",
          method: "updateAppSettings",
          params: { patch: { locale: "en" } },
        }),
      });
      expect(setRes.status).toBe(200);
      const setBody = (await setRes.json()) as { error?: unknown };
      expect(setBody.error).toBeUndefined();
      const payload = await settingsEvent;
      expect(payload).toBeTruthy();

      ws.close();
    } finally {
      await host.close();
    }
  });

  it("closes WS when auth token is wrong", async () => {
    const { host } = await start();
    try {
      const ws = new WebSocket(host.wsEventsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      const closed = new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
      });
      ws.send(JSON.stringify({ type: "auth", token: "wrong-token" }));
      await closed;
    } finally {
      await host.close();
    }
  });

  it("READY includes wsEventsUrl", async () => {
    const { host } = await start();
    try {
      const ready = formatServiceHostReadyLine(host);
      expect(ready.startsWith(SERVICE_HOST_READY_PREFIX)).toBe(true);
      const payload = JSON.parse(
        ready.slice(SERVICE_HOST_READY_PREFIX.length),
      ) as { wsEventsUrl?: string; baseUrl?: string };
      expect(payload.wsEventsUrl).toBe(host.wsEventsUrl);
      expect(payload.baseUrl).toBe(host.baseUrl);
    } finally {
      await host.close();
    }
  });
});

describe("host HTTP media (#553)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function start() {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-media-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    const token = readFileSync(
      defaultServiceIpcTokenPath(dataDir),
      "utf8",
    ).trim();
    return { host, token, dataDir };
  }

  function writeVaultMediaFile(dataDir: string, contents: string): string {
    const root = vaultsRoot(dataDir);
    const vaultIds = readdirSync(root).filter((name) => !name.startsWith("."));
    expect(vaultIds.length).toBeGreaterThan(0);
    const mediaDir = join(
      root,
      vaultIds[0]!,
      "media",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    mkdirSync(mediaDir, { recursive: true });
    const filePath = join(mediaDir, "cover.webp");
    writeFileSync(filePath, contents);
    return filePath;
  }

  it("rejects /media/file without auth", async () => {
    const { host, dataDir } = await start();
    try {
      const filePath = writeVaultMediaFile(dataDir, "webp-bytes");
      const res = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(filePath)}`,
      );
      expect(res.status).toBe(401);
    } finally {
      await host.close();
    }
  });

  it("serves vault file with query token and Bearer", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = writeVaultMediaFile(dataDir, "hello-media");
      const withQuery = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`,
      );
      expect(withQuery.status).toBe(200);
      expect(withQuery.headers.get("content-type")).toBe("image/webp");
      expect(await withQuery.text()).toBe("hello-media");

      const withBearer = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(filePath)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(withBearer.status).toBe(200);
      expect(await withBearer.text()).toBe("hello-media");
    } finally {
      await host.close();
    }
  });

  it("rejects path outside vaults root", async () => {
    const { host, token, dataDir } = await start();
    try {
      const outside = join(dataDir, "outside.bin");
      writeFileSync(outside, "secret");
      const res = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(outside)}&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(403);
    } finally {
      await host.close();
    }
  });

  it("supports Range and HEAD", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = writeVaultMediaFile(dataDir, "0123456789");
      const ranged = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`,
        { headers: { Range: "bytes=0-3" } },
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe("bytes 0-3/10");
      expect(await ranged.text()).toBe("0123");

      const head = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`,
        { method: "HEAD" },
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe("10");
      expect(await head.text()).toBe("");
    } finally {
      await host.close();
    }
  });
});
