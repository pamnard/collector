/**
 * createHostItemsPort.subscribeDashboardLoad against a real service host (#797).
 * Index page after real create/update; aborted subscribe tears down without handlers.
 */

import type { DashboardIndexPage } from "@collector/api";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServiceHost } from "@collector/service/host";
import type { CollectorHostServiceClient } from "../host-collector-client.js";
import { connectCollectorHostService } from "../host-collector-client-node.js";

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

async function waitForItemIndexed(
  client: CollectorHostServiceClient,
  itemId: string,
): Promise<void> {
  await vi.waitFor(async () => {
    const result = await client.items.queryIndex("all", undefined, {
      limit: 100,
      offset: 0,
    });
    expect(result.ids).toContain(itemId);
  });
}

describe("createHostItemsPort.subscribeDashboardLoad (#797)", () => {
  it("delivers index page for created then updated item over startServiceHost wire", async () => {
    const dataDir = tempDataDir("collector-items-subscribe-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, {
        dataDir,
      });
      try {
        const created = await client.items.createItem({
          title: "Subscribe Note",
          content_type: "note",
          content: "body",
        });
        await waitForItemIndexed(client, created.id);

        const pages: DashboardIndexPage[] = [];
        const onLoadComplete = vi.fn();
        const onError = vi.fn();
        const sub = client.items.subscribeDashboardLoad("all", "", {
          onIndexPage: (page) => {
            pages.push(page);
          },
          onLoadComplete,
          onError,
        });

        await vi.waitFor(() => {
          expect(pages).toHaveLength(1);
          expect(onLoadComplete).toHaveBeenCalledTimes(1);
        });
        expect(onError).not.toHaveBeenCalled();
        expect(pages[0]!.itemIds).toContain(created.id);
        expect(pages[0]!.totalCount).toBeGreaterThanOrEqual(1);
        expect(pages[0]!.stamps).toHaveLength(pages[0]!.itemIds.length);
        const stampAfterCreate =
          pages[0]!.stamps[pages[0]!.itemIds.indexOf(created.id)];
        expect(stampAfterCreate).toBeTruthy();
        sub.unsubscribe();

        const updated = await client.items.updateItem(created.id, {
          title: "Subscribe Note 2",
          description: "fresh",
        });
        expect(updated.title).toBe("Subscribe Note 2");

        await vi.waitFor(async () => {
          const after = await client.items.queryIndex("all", undefined, {
            limit: 24,
            offset: 0,
          });
          const afterStamp = after.stamps[after.ids.indexOf(created.id)];
          expect(afterStamp).toBeTruthy();
          expect(afterStamp).not.toEqual(stampAfterCreate);
        });

        const pagesAfterUpdate: DashboardIndexPage[] = [];
        const completeAfterUpdate = vi.fn();
        const sub2 = client.items.subscribeDashboardLoad("all", "", {
          onIndexPage: (page) => {
            pagesAfterUpdate.push(page);
          },
          onLoadComplete: completeAfterUpdate,
          onError,
        });
        await vi.waitFor(() => {
          expect(pagesAfterUpdate).toHaveLength(1);
          expect(completeAfterUpdate).toHaveBeenCalledTimes(1);
        });
        expect(onError).not.toHaveBeenCalled();
        expect(pagesAfterUpdate[0]!.itemIds).toContain(created.id);
        const stampAfterUpdate =
          pagesAfterUpdate[0]!.stamps[
            pagesAfterUpdate[0]!.itemIds.indexOf(created.id)
          ];
        expect(stampAfterUpdate).not.toEqual(stampAfterCreate);
        sub2.unsubscribe();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("aborted subscribe tears down without onIndexPage or onError", async () => {
    const dataDir = tempDataDir("collector-items-subscribe-abort-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const client = await connectCollectorHostService(host.baseUrl, {
        dataDir,
      });
      try {
        await client.boot.ensureActiveVault();

        const onIndexPage = vi.fn();
        const onLoadComplete = vi.fn();
        const onError = vi.fn();
        const sub = client.items.subscribeDashboardLoad(
          "all",
          "",
          { onIndexPage, onLoadComplete, onError },
          AbortSignal.abort(),
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(onIndexPage).not.toHaveBeenCalled();
        expect(onLoadComplete).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        sub.unsubscribe();

        const pages: DashboardIndexPage[] = [];
        const liveComplete = vi.fn();
        const live = client.items.subscribeDashboardLoad("all", "", {
          onIndexPage: (page) => {
            pages.push(page);
          },
          onLoadComplete: liveComplete,
          onError,
        });
        await vi.waitFor(() => {
          expect(pages).toHaveLength(1);
          expect(liveComplete).toHaveBeenCalledTimes(1);
        });
        expect(onError).not.toHaveBeenCalled();
        expect(pages[0]!.totalCount).toBeGreaterThanOrEqual(0);
        live.unsubscribe();
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });
});
