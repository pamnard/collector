/**
 * HTTP RPC / events / auth / media surfaces for the domain host (#551 / #553).
 */

import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { vaultsRoot } from "@collector/core";
import { defaultServiceHostTokenPath } from "../wire/auth.js";
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
      defaultServiceHostTokenPath(dataDir),
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

  it("POST /api/rpc ensure/persist/clear dashboard snapshot (#552)", async () => {
    const { host, token } = await start();
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };
      const ensureRes = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "1",
          method: "ensureDashboardSnapshot",
        }),
      });
      expect(ensureRes.status).toBe(200);
      const ensureBody = (await ensureRes.json()) as {
        result?: unknown;
        error?: unknown;
      };
      expect(ensureBody.error).toBeUndefined();
      expect(ensureBody.result === null || typeof ensureBody.result === "object").toBe(
        true,
      );

      const snapshot = {
        schema_version: 2,
        vault_id: "00000000-0000-4000-8000-000000000099",
        nav_filter: "all",
        search: "",
        sort_key: "created_at",
        sort_dir: "desc",
        item_ids: [],
        items: [],
        total_count: 0,
        stream_end_offset: 0,
        cover_paths: {},
        saved_at: "2026-08-06T00:00:00.000Z",
      };
      const persistRes = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "2",
          method: "persistDashboardSnapshot",
          params: { snapshot },
        }),
      });
      expect(persistRes.status).toBe(200);
      const persistBody = (await persistRes.json()) as { error?: unknown };
      expect(persistBody.error).toBeUndefined();

      const reloadRes = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "3",
          method: "ensureDashboardSnapshot",
        }),
      });
      const reloadBody = (await reloadRes.json()) as {
        result?: { vault_id?: string };
        error?: unknown;
      };
      expect(reloadBody.error).toBeUndefined();
      expect(reloadBody.result?.vault_id).toBe(snapshot.vault_id);

      const clearRes = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "4",
          method: "clearDashboardSnapshot",
        }),
      });
      expect(clearRes.status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it("POST /api/rpc resolveItemThumbnailPaths returns wire rows (#552)", async () => {
    const { host, token } = await start();
    try {
      const res = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "thumbs",
          method: "resolveItemThumbnailPaths",
          params: {
            items: [
              {
                id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md",
                thumbnail: null,
              },
            ],
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result?: Array<{ id: string; path: string | null }>;
        error?: unknown;
      };
      expect(body.error).toBeUndefined();
      expect(Array.isArray(body.result)).toBe(true);
      expect(body.result?.[0]?.id).toBe(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md",
      );
      expect(
        body.result?.[0]?.path === null ||
          typeof body.result?.[0]?.path === "string",
      ).toBe(true);
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
      defaultServiceHostTokenPath(dataDir),
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

describe("host HTTP /media/derive (#882)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function start() {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-derive-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    const token = readFileSync(
      defaultServiceHostTokenPath(dataDir),
      "utf8",
    ).trim();
    return { host, token, dataDir };
  }

  async function writeVaultPng(
    dataDir: string,
    width: number,
    height: number,
  ): Promise<string> {
    const { default: sharp } = await import("sharp");
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
    const filePath = join(mediaDir, "source.png");
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 30, g: 60, b: 90 },
      },
    })
      .png()
      .toFile(filePath);
    return filePath;
  }

  it("rejects /media/derive without auth", async () => {
    const { host, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 400, 200);
      const res = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=256`,
      );
      expect(res.status).toBe(401);
    } finally {
      await host.close();
    }
  });

  it("rejects unknown whitelist w with 400", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 400, 200);
      const res = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=123&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(400);
    } finally {
      await host.close();
    }
  });

  it("rejects path outside vaults root", async () => {
    const { host, token, dataDir } = await start();
    try {
      const outside = join(dataDir, "outside.png");
      const { default: sharp } = await import("sharp");
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: { r: 1, g: 1, b: 1 },
        },
      })
        .png()
        .toFile(outside);
      const res = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(outside)}&w=128&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(403);
    } finally {
      await host.close();
    }
  });

  it("serves webp at whitelist width without upscale; cache hit skips re-encode", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 200, 100);
      const url = `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=640&token=${encodeURIComponent(token)}`;

      const first = await fetch(url);
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toBe("image/webp");
      expect(first.headers.get("cache-control")).toBe(
        "private, max-age=0, must-revalidate",
      );
      expect(first.headers.get("cache-control")).not.toMatch(/immutable/);
      const etag = first.headers.get("etag");
      expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
      const firstBytes = Buffer.from(await first.arrayBuffer());
      const { default: sharp } = await import("sharp");
      const firstMeta = await sharp(firstBytes).metadata();
      expect(firstMeta.format).toBe("webp");
      expect(firstMeta.width).toBe(200);
      expect(firstMeta.height).toBe(100);

      const cacheDir = join(dataDir, "image-derive-cache");
      const before = readdirSync(cacheDir);
      expect(before.length).toBe(1);

      const second = await fetch(url);
      expect(second.status).toBe(200);
      const secondBytes = Buffer.from(await second.arrayBuffer());
      expect(Buffer.compare(firstBytes, secondBytes)).toBe(0);
      expect(readdirSync(cacheDir)).toEqual(before);

      const notModified = await fetch(url, {
        headers: { "If-None-Match": etag! },
      });
      expect(notModified.status).toBe(304);
      expect((await notModified.arrayBuffer()).byteLength).toBe(0);

      const head = await fetch(url, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe("image/webp");
      expect(head.headers.get("etag")).toBe(etag);
      expect((await head.arrayBuffer()).byteLength).toBe(0);

      const withBearer = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=640`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      expect(withBearer.status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it("long max-age only when v matches source mtime; never immutable", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 400, 200);
      const mtimeMs = Math.trunc(statSync(filePath).mtimeMs);
      const matched = `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=256&v=${mtimeMs}&token=${encodeURIComponent(token)}`;
      const mismatched = `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=256&v=${mtimeMs + 1}&token=${encodeURIComponent(token)}`;

      const ok = await fetch(matched);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("cache-control")).toBe("private, max-age=31536000");
      expect(ok.headers.get("cache-control")).not.toMatch(/immutable/);
      expect(ok.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);

      const staleV = await fetch(mismatched);
      expect(staleV.status).toBe(200);
      expect(staleV.headers.get("cache-control")).toBe(
        "private, max-age=0, must-revalidate",
      );
      expect(staleV.headers.get("cache-control")).not.toMatch(/immutable/);
    } finally {
      await host.close();
    }
  });

  it("rejects invalid v query with 400", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 64, 32);
      const res = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=128&v=nope&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(400);
    } finally {
      await host.close();
    }
  });

  it("downscales wide sources to requested w", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 1600, 800);
      const res = await fetch(
        `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=480&token=${encodeURIComponent(token)}`,
      );
      expect(res.status).toBe(200);
      const { default: sharp } = await import("sharp");
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect(meta.width).toBe(480);
      expect(meta.height).toBe(240);
    } finally {
      await host.close();
    }
  });

  it("uses a new cache entry when source mtime changes", async () => {
    const { host, token, dataDir } = await start();
    try {
      const filePath = await writeVaultPng(dataDir, 400, 200);
      const url = `${host.baseUrl}/media/derive?path=${encodeURIComponent(filePath)}&w=256&token=${encodeURIComponent(token)}`;
      const first = await fetch(url);
      expect(first.status).toBe(200);
      const cacheDir = join(dataDir, "image-derive-cache");
      const before = readdirSync(cacheDir);
      expect(before.length).toBe(1);

      const next = new Date(Date.now() + 60_000);
      utimesSync(filePath, next, next);

      const second = await fetch(url);
      expect(second.status).toBe(200);
      const after = readdirSync(cacheDir);
      expect(after.length).toBe(2);
      expect(after).not.toEqual(before);
    } finally {
      await host.close();
    }
  });
});
