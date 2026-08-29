/**
 * Thumbnail resolve session outcomes via production host port (#552 / #823).
 * Fake transport returns host-shaped wire rows; asserts path maps, abort, errors —
 * not mock call counts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ItemFile } from "@collector/shared";
import { createHostThumbnailsPort } from "@collector/client";
import {
  hostWireError,
  type HostWireClient,
} from "@collector/service/wire";

type WireRow = {
  id: string;
  path: string | null;
  width?: number | null;
  height?: number | null;
};

function stubItem(
  id: string,
  thumbnail: string | null = "cover.webp",
): ItemFile {
  return {
    id,
    thumbnail,
    title: id,
    description: "",
    url: null,
    content_type: "note",
    tag_ids: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  } as ItemFile;
}

function fakeTransport(
  requestImpl: (
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>,
): HostWireClient {
  return {
    request: async (method, params, options) =>
      requestImpl(method, params, options),
    ping: async () => ({ ok: true as const, pong: true as const }),
    health: async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    }),
    onEvent: () => () => {},
    close: async () => {},
  };
}

function hostCoverPath(itemId: string): string {
  return `/vault/media/${itemId}/cover.webp`;
}

describe("createHostThumbnailsPort session outcomes (host wire)", () => {
  it("resolveItemThumbnailPaths builds Map from host-shaped wire rows", async () => {
    const a = stubItem("Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md");
    const b = stubItem("Inbox/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.md", null);

    const transport = fakeTransport(async (method, params) => {
      assert.equal(method, "resolveItemThumbnailPaths");
      const items = (params as { items: Array<{ id: string; thumbnail: string | null }> })
        .items;
      assert.deepEqual(
        items.map((row) => ({ id: row.id, thumbnail: row.thumbnail })),
        [
          { id: a.id, thumbnail: "cover.webp" },
          { id: b.id, thumbnail: null },
        ],
      );
      const rows: WireRow[] = [
        {
          id: a.id,
          path: hostCoverPath(a.id),
          width: 640,
          height: 480,
        },
        {
          id: b.id,
          path: null,
          width: null,
          height: null,
        },
      ];
      return rows;
    });

    const session = createHostThumbnailsPort(transport);
    const paths = await session.resolveItemThumbnailPaths([a, b]);

    assert.equal(paths.get(a.id), hostCoverPath(a.id));
    assert.equal(paths.get(b.id), null);
    assert.equal(paths.size, 2);
  });

  it("resolveItemThumbnailPath returns host absolute path or null", async () => {
    const covered = stubItem("note-covered.md");
    const bare = stubItem("note-bare.md", null);
    const byId = new Map<string, string | null>([
      [covered.id, hostCoverPath(covered.id)],
      [bare.id, null],
    ]);

    const transport = fakeTransport(async (method, params) => {
      assert.equal(method, "resolveItemThumbnailPath");
      const item = (params as { item: { id: string } }).item;
      if (!byId.has(item.id)) {
        throw new Error(`unexpected id ${item.id}`);
      }
      return byId.get(item.id);
    });

    const session = createHostThumbnailsPort(transport);
    assert.equal(
      await session.resolveItemThumbnailPath(covered),
      hostCoverPath(covered.id),
    );
    assert.equal(await session.resolveItemThumbnailPath(bare), null);
  });

  it("progressive resolve emits path and pixel size per id", async () => {
    const item = stubItem("note-1.md");
    const transport = fakeTransport(async (method, params) => {
      assert.equal(method, "resolveItemThumbnailPaths");
      const items = (params as { items: Array<{ id: string }> }).items;
      return items.map(
        (row): WireRow => ({
          id: row.id,
          path: hostCoverPath(row.id),
          width: 320,
          height: 240,
        }),
      );
    });

    const session = createHostThumbnailsPort(transport);
    const emitted: Array<{
      id: string;
      path: string | null;
      size: { width: number; height: number } | null;
    }> = [];

    await session.resolveItemThumbnailPathsProgressive([item], {
      onResolved: (id, path, size) => {
        emitted.push({ id, path, size });
      },
    });

    assert.deepEqual(emitted, [
      {
        id: item.id,
        path: hostCoverPath(item.id),
        size: { width: 320, height: 240 },
      },
    ]);
  });

  it("abort stops further progressive emits and settles", async () => {
    const controller = new AbortController();
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let requestCount = 0;

    const transport = fakeTransport(async (method, params, options) => {
      assert.equal(method, "resolveItemThumbnailPaths");
      requestCount += 1;
      const items = (params as { items: Array<{ id: string }> }).items;
      const id = items[0]!.id;
      if (id === "slow") {
        await slowGate;
        if (options?.signal?.aborted) {
          throw hostWireError({
            layer: "transport",
            code: "cancelled",
            message: "RPC cancelled",
          });
        }
      }
      return [
        {
          id,
          path: hostCoverPath(id),
          width: 10,
          height: 10,
        },
      ] satisfies WireRow[];
    });

    const session = createHostThumbnailsPort(transport);
    const emitted: string[] = [];
    const run = session.resolveItemThumbnailPathsProgressive(
      [stubItem("slow"), stubItem("after-abort")],
      {
        concurrency: 1,
        signal: controller.signal,
        onResolved: (id) => {
          emitted.push(id);
        },
      },
    );

    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    releaseSlow?.();
    await run;

    assert.deepEqual(emitted, []);
    assert.equal(requestCount, 1);
  });

  it("non-cancel host wire errors propagate from progressive resolve", async () => {
    const transport = fakeTransport(async () => {
      throw hostWireError({
        layer: "domain",
        code: "internal",
        message: "thumbnail resolve failed",
      });
    });

    const session = createHostThumbnailsPort(transport);
    await assert.rejects(
      () =>
        session.resolveItemThumbnailPathsProgressive([stubItem("boom.md")], {
          onResolved: () => {
            assert.fail("onResolved must not run after wire failure");
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /thumbnail resolve failed/);
        return true;
      },
    );
  });

  it("sticky null from host stays null across repeated batch resolves", async () => {
    const item = stubItem("sticky-null.md", null);
    let batchCalls = 0;

    const transport = fakeTransport(async (method, params) => {
      assert.equal(method, "resolveItemThumbnailPaths");
      batchCalls += 1;
      const items = (params as { items: Array<{ id: string }> }).items;
      return items.map(
        (row): WireRow => ({
          id: row.id,
          path: null,
          width: null,
          height: null,
        }),
      );
    });

    const session = createHostThumbnailsPort(transport);
    const first = await session.resolveItemThumbnailPaths([item]);
    const second = await session.resolveItemThumbnailPaths([item]);

    assert.equal(first.get(item.id), null);
    assert.equal(second.get(item.id), null);
    assert.equal(batchCalls, 2);
  });

  it("resolveItemHeroMedia returns host hero contract", async () => {
    const item = stubItem("hero.md");
    const hero = {
      kind: "image" as const,
      filePath: `/vault/media/${item.id}/hero.jpg`,
      displayPath: `/vault/media/${item.id}/hero.jpg`,
    };

    const transport = fakeTransport(async (method, params) => {
      assert.equal(method, "resolveItemHeroMedia");
      assert.deepEqual(params, { item: { id: item.id } });
      return hero;
    });

    const session = createHostThumbnailsPort(transport);
    assert.deepEqual(await session.resolveItemHeroMedia(item), hero);
  });

  it("empty item list yields empty map and skips progressive work", async () => {
    let called = false;
    const transport = fakeTransport(async () => {
      called = true;
      throw new Error("transport must not be called for empty batch");
    });

    const session = createHostThumbnailsPort(transport);
    const paths = await session.resolveItemThumbnailPaths([]);
    assert.equal(paths.size, 0);

    await session.resolveItemThumbnailPathsProgressive([], {
      onResolved: () => {
        assert.fail("onResolved must not run for empty list");
      },
    });
    assert.equal(called, false);
  });
});
