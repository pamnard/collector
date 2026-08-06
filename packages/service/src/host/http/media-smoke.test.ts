/**
 * Standalone host media smoke for #553 (auth URL, Range, traversal).
 * Run: npx vitest run src/host/http/media-smoke.test.ts -w @collector/service
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
import { vaultsRoot } from "@collector/core";
import { defaultServiceHostTokenPath } from "../wire/auth.js";
import { startServiceHost } from "../service-host.js";

describe("host media accept smoke (#553)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves cover+video bytes with Range and rejects escape", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-553-accept-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const token = readFileSync(
        defaultServiceHostTokenPath(dataDir),
        "utf8",
      ).trim();
      const root = vaultsRoot(dataDir);
      const vaultId = readdirSync(root).filter((n) => !n.startsWith("."))[0]!;
      const mediaDir = join(
        root,
        vaultId,
        "media",
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
      mkdirSync(mediaDir, { recursive: true });
      const coverPath = join(mediaDir, "cover.webp");
      const videoPath = join(mediaDir, "clip.mp4");
      writeFileSync(coverPath, "COVER");
      writeFileSync(videoPath, "0123456789ABCDEF");

      const coverUrl = `${host.baseUrl}/media/file?path=${encodeURIComponent(coverPath)}&token=${encodeURIComponent(token)}`;
      expect(coverUrl.startsWith("http://")).toBe(true);
      expect(coverUrl.includes("asset:")).toBe(false);

      const cover = await fetch(coverUrl);
      expect(cover.status).toBe(200);
      expect(await cover.text()).toBe("COVER");

      const videoUrl = `${host.baseUrl}/media/file?path=${encodeURIComponent(videoPath)}&token=${encodeURIComponent(token)}`;
      const seek = await fetch(videoUrl, { headers: { Range: "bytes=8-11" } });
      expect(seek.status).toBe(206);
      expect(seek.headers.get("accept-ranges")).toBe("bytes");
      expect(await seek.text()).toBe("89AB");

      const outside = join(dataDir, "escape.bin");
      writeFileSync(outside, "nope");
      const denied = await fetch(
        `${host.baseUrl}/media/file?path=${encodeURIComponent(outside)}&token=${encodeURIComponent(token)}`,
      );
      expect(denied.status).toBe(403);
    } finally {
      await host.close();
    }
  });
});
