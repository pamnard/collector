/**
 * createHostMediaPort against a real service host (#923).
 * Attach / list / cover / replace / delete over HTTP with Node thumbnail paths.
 */

import {
  MEDIA_PORT_KEYS,
  type MediaPort,
} from "@collector/api";
import type { HostWireClient } from "@collector/service/wire";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveServiceHostToken,
  startServiceHost,
} from "@collector/service/host";
import { createCollectorHostService } from "../host-collector-client.js";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createNodeThumbnailPaths } from "../node-thumbnails.js";
import { createHostMediaPort } from "./media.js";

const dirs: string[] = [];

/** Minimal 1x1 PNG — same fixture as host-collector-client media suites. */
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDataDir(prefix: string): string {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dataDir);
  return dataDir;
}

function unusedTransport(): HostWireClient {
  return {
    request: vi.fn(async () => {
      throw new Error("unused");
    }),
    ping: vi.fn(async () => ({ ok: true as const, pong: true as const })),
    health: vi.fn(async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    })),
    onEvent: vi.fn(() => () => {}),
    close: vi.fn(async () => {}),
  };
}

describe("createHostMediaPort (#923)", () => {
  it("MEDIA_PORT_KEYS are all functions on the port", () => {
    const port = createHostMediaPort(createHostSessionCtx(unusedTransport()));
    for (const key of MEDIA_PORT_KEYS) {
      expect(typeof port[key as keyof MediaPort], key).toBe("function");
    }
  });

  it("attach/list/cover/replace/delete round-trip over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-media-port-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const service = createCollectorHostService(transport);
        await service.boot.ensureActiveVault();

        const port = createHostMediaPort(
          createHostSessionCtx(transport, {
            thumbnails: createNodeThumbnailPaths(transport),
          }),
        );

        const item = await service.items.createItem({
          title: "Media port note",
          content_type: "note",
          content: "m",
        });

        expect(await port.resolveItemThumbnailPath(item)).toBeNull();

        const attached = await port.attachMediaFiles(item.id, [
          { name: "dot.png", bytes: PNG_1X1 },
        ]);
        expect(attached).toHaveLength(1);
        expect(attached[0]!.filename).toBe("dot.png");
        const mediaId = attached[0]!.id;

        const listed = await port.listItemMedia(item.id);
        expect(listed.some((row) => row.id === mediaId)).toBe(true);

        const covered = await port.setItemCoverFromMedia(item.id, mediaId);
        expect(covered.id).toBe(item.id);
        expect(covered.thumbnail ?? null).toBeNull();
        const coverPath = await port.resolveItemThumbnailPath(covered);
        expect(typeof coverPath).toBe("string");
        expect(coverPath!.length).toBeGreaterThan(0);

        const replaced = await port.replaceItemMedia(item.id, mediaId, {
          name: "dot2.png",
          bytes: PNG_1X1,
        });
        expect(replaced.id).toBe(mediaId);
        expect(replaced.filename).toBe("dot2.png");

        const afterReplace = await port.listItemMedia(item.id);
        expect(afterReplace).toHaveLength(1);
        expect(afterReplace[0]!.filename).toBe("dot2.png");

        await port.deleteItemMedia(item.id, mediaId);
        const afterDelete = await port.listItemMedia(item.id);
        expect(afterDelete.some((row) => row.id === mediaId)).toBe(false);
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
