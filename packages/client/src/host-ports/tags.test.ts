/**
 * createHostTagsPort against a real service host (#842).
 * Catalog is derived from item writes; listTags / subscribeTags over HTTP RPC.
 */

import { TAGS_PORT_KEYS, type TagWithCount, type TagsPort } from "@collector/api";
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
import { createHostTagsPort } from "./tags.js";

const dirs: string[] = [];

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

describe("createHostTagsPort (#842)", () => {
  it("TAGS_PORT_KEYS is list/subscribe only", () => {
    expect([...TAGS_PORT_KEYS].sort()).toEqual(
      ["listTags", "subscribeTags"].sort(),
    );
  });

  it("listTags and subscribeTags reflect tags assigned on items over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-tags-port-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const service = createCollectorHostService(transport);
        await service.boot.ensureActiveVault();

        const port = createHostTagsPort(createHostSessionCtx(transport));
        for (const key of TAGS_PORT_KEYS) {
          expect(
            typeof port[key as keyof TagsPort],
            key,
          ).toBe("function");
        }
        expect(port).not.toHaveProperty("createTag");
        expect(port).not.toHaveProperty("deleteTag");
        expect(port).not.toHaveProperty("updateTagRecord");

        expect(await port.listTags()).toEqual([]);

        const item = await service.items.createItem({
          title: "Tagged note",
          content_type: "note",
          content: "body",
        });
        const updated = await service.items.updateItem(item.id, {
          tags: ["wire-tag"],
        });
        expect(updated.tag_ids).toHaveLength(1);

        let listed: TagWithCount[] = [];
        await vi.waitFor(
          async () => {
            listed = await port.listTags();
            expect(listed.some((t) => t.name === "wire-tag")).toBe(true);
          },
          { timeout: 10_000 },
        );

        const row = listed.find((t) => t.name === "wire-tag")!;
        expect(row.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(row.item_count).toBe(1);
        expect(row.color).toBeNull();

        const updates: TagWithCount[][] = [];
        const sub = port.subscribeTags((next) => {
          updates.push(next);
        });
        await vi.waitFor(() => {
          expect(updates.length).toBeGreaterThanOrEqual(1);
          expect(updates[0]!.some((t) => t.name === "wire-tag")).toBe(true);
          expect(
            updates[0]!.find((t) => t.name === "wire-tag")?.item_count,
          ).toBe(1);
        });
        sub.unsubscribe();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
