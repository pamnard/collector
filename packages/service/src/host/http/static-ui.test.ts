/**
 * Static UI serving + /api/ui-bootstrap (#555).
 */

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultServiceHostTokenPath } from "../wire/auth.js";
import { startServiceHost } from "../service-host.js";
import { isReservedHostPath, resolveUiFilePath } from "./static-ui.js";

describe("static-ui helpers (#555)", () => {
  it("marks API and media paths reserved", () => {
    expect(isReservedHostPath("/api/rpc")).toBe(true);
    expect(isReservedHostPath("/api/events")).toBe(true);
    expect(isReservedHostPath("/api/ui-bootstrap")).toBe(true);
    expect(isReservedHostPath("/media/file")).toBe(true);
    expect(isReservedHostPath("/ping")).toBe(true);
    expect(isReservedHostPath("/")).toBe(false);
    expect(isReservedHostPath("/settings")).toBe(false);
  });

  it("rejects path escape outside uiDir", () => {
    const uiDir = mkdtempSync(join(tmpdir(), "collector-ui-escape-"));
    try {
      expect(resolveUiFilePath(uiDir, "/../../etc/passwd")).toBeNull();
    } finally {
      rmSync(uiDir, { recursive: true, force: true });
    }
  });
});

describe("host static UI + ui-bootstrap (#555)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns 404 for /api/ui-bootstrap when uiDir is unset", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-noui-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const res = await fetch(`${host.baseUrl}/api/ui-bootstrap`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "ui_not_configured" });
    } finally {
      await host.close();
    }
  });

  it("serves index.html, SPA fallback, bootstrap, and keeps /api/rpc", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-host-ui-"));
    const uiDir = mkdtempSync(join(tmpdir(), "collector-ui-dist-"));
    dirs.push(dataDir, uiDir);
    writeFileSync(
      join(uiDir, "index.html"),
      "<!doctype html><title>collector</title><div id=\"root\"></div>\n",
    );
    mkdirSync(join(uiDir, "assets"), { recursive: true });
    writeFileSync(join(uiDir, "assets", "app.js"), "console.log('ok');\n");

    const host = await startServiceHost({ dataDir, port: 0, uiDir });
    try {
      expect(host.uiDir).toBe(uiDir);

      const index = await fetch(`${host.baseUrl}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-type")).toMatch(/text\/html/);
      expect(await index.text()).toContain("collector");

      const asset = await fetch(`${host.baseUrl}/assets/app.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain("console.log");

      const spa = await fetch(`${host.baseUrl}/settings`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("collector");

      const bootstrap = await fetch(`${host.baseUrl}/api/ui-bootstrap`);
      expect(bootstrap.status).toBe(200);
      const body = (await bootstrap.json()) as {
        baseUrl: string;
        token: string;
        wsEventsUrl: string;
      };
      expect(body.baseUrl).toBe(host.baseUrl);
      expect(body.wsEventsUrl).toBe(host.wsEventsUrl);
      expect(body.token.length).toBeGreaterThan(0);

      const token = readFileSync(
        defaultServiceHostTokenPath(dataDir),
        "utf8",
      ).trim();
      expect(body.token).toBe(token);

      const rpc = await fetch(`${host.baseUrl}/api/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: "1", method: "getDataDirectory" }),
      });
      expect(rpc.status).toBe(200);
      expect(await rpc.json()).toMatchObject({ id: "1", result: dataDir });
    } finally {
      await host.close();
    }
  });
});
