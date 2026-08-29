/**
 * createHostDashboardSnapshotPort against a real service host (#552).
 * ensure/persist/clear over HTTP RPC; peek is the client cache after load.
 */

import {
  DASHBOARD_SNAPSHOT_PORT_KEYS,
  type DashboardSnapshotPort,
} from "@collector/api";
import {
  DASHBOARD_SNAPSHOT_VERSION,
  type DashboardSnapshot,
} from "@collector/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveServiceHostToken,
  startServiceHost,
} from "@collector/service/host";
import { createCollectorHostService } from "../host-collector-client.js";
import { createHttpHostTransport } from "../http-host-transport.js";
import { createHostDashboardSnapshotPort } from "./dashboard-snapshot.js";

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

function assertSnapshotFields(
  snapshot: DashboardSnapshot,
  expected: { vaultId: string; search: string },
): void {
  expect(snapshot.schema_version).toBe(DASHBOARD_SNAPSHOT_VERSION);
  expect(snapshot.vault_id).toBe(expected.vaultId);
  expect(snapshot.nav_filter).toBe("all");
  expect(snapshot.search).toBe(expected.search);
  expect(snapshot.sort_key).toBe("created_at");
  expect(snapshot.sort_dir).toBe("desc");
  expect(snapshot.item_ids).toEqual([]);
  expect(snapshot.items).toEqual([]);
  expect(snapshot.total_count).toBe(0);
  expect(snapshot.stream_end_offset).toBe(0);
  expect(snapshot.cover_paths).toEqual({});
  expect(typeof snapshot.saved_at).toBe("string");
  expect(snapshot.saved_at.length).toBeGreaterThan(0);
}

describe("createHostDashboardSnapshotPort (#552)", () => {
  it("DASHBOARD_SNAPSHOT_PORT_KEYS is the contract for the snapshot port surface", () => {
    expect(DASHBOARD_SNAPSHOT_PORT_KEYS).toEqual([
      "ensureDashboardSnapshot",
      "peekMatchingDashboardSnapshot",
      "persistDashboardSnapshot",
      "clearDashboardSnapshot",
      "buildDashboardSnapshot",
    ]);
  });

  it("ensure/persist/peek round-trip over startServiceHost wire returns host snapshot fields", async () => {
    const dataDir = tempDataDir("collector-dash-snap-port-");
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      const transport = await createHttpHostTransport({
        baseUrl: host.baseUrl,
        token: await resolveServiceHostToken({ dataDir }),
      });
      try {
        const active = await createCollectorHostService(
          transport,
        ).boot.ensureActiveVault();
        expect(active.vault.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );

        const port = createHostDashboardSnapshotPort(transport);
        for (const key of DASHBOARD_SNAPSHOT_PORT_KEYS) {
          expect(
            typeof port[key as keyof DashboardSnapshotPort],
            key,
          ).toBe("function");
        }

        await port.clearDashboardSnapshot();
        expect(await port.ensureDashboardSnapshot()).toBeNull();
        expect(
          port.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "",
          }),
        ).toBeNull();

        const built = port.buildDashboardSnapshot({
          vaultId: active.vault.id,
          filter: "all",
          search: "q",
          itemIds: [],
          items: [],
          totalCount: 0,
          streamEndOffset: 0,
        });
        assertSnapshotFields(built, {
          vaultId: active.vault.id,
          search: "q",
        });

        await port.persistDashboardSnapshot(built);
        const peeked = port.peekMatchingDashboardSnapshot({
          vaultId: active.vault.id,
          filter: "all",
          search: "q",
        });
        expect(peeked).not.toBeNull();
        assertSnapshotFields(peeked!, {
          vaultId: active.vault.id,
          search: "q",
        });
        expect(
          port.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "",
          }),
        ).toBeNull();

        // Fresh port: local cache empty until ensure loads from the host.
        const peer = createHostDashboardSnapshotPort(transport);
        expect(
          peer.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "q",
          }),
        ).toBeNull();

        const loaded = await peer.ensureDashboardSnapshot();
        expect(loaded).not.toBeNull();
        assertSnapshotFields(loaded!, {
          vaultId: active.vault.id,
          search: "q",
        });
        expect(loaded!.saved_at).toBe(built.saved_at);
        expect(
          peer.peekMatchingDashboardSnapshot({
            vaultId: active.vault.id,
            filter: "all",
            search: "q",
          }),
        ).toEqual(loaded);

        await peer.clearDashboardSnapshot();
        const afterClear = createHostDashboardSnapshotPort(transport);
        expect(await afterClear.ensureDashboardSnapshot()).toBeNull();
      } finally {
        await transport.close();
      }
    } finally {
      await host.close();
    }
  });
});
