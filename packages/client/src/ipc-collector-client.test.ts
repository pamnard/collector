import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ServiceIpcError,
  startServiceHost,
  type ServiceIpcClient,
} from "@collector/service";
import {
  connectCollectorIpcClient,
  createCollectorIpcClient,
} from "./ipc-collector-client.js";

describe("CollectorIpcClient", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("health works end-to-end against the service host", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-client-"));
    dirs.push(dataDir);
    const host = await startServiceHost({ dataDir, port: 0 });
    try {
      expect(host.ipcPath).toBeTruthy();
      const client = await connectCollectorIpcClient(host.ipcPath!);
      try {
        expect(await client.ping()).toEqual({ ok: true, pong: true });
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
      } finally {
        await client.close();
      }
    } finally {
      await host.close();
    }
  });

  it("unimplemented domain methods fail fast without inventing defaults", async () => {
    const transport = {
      ping: async () => ({ ok: true as const, pong: true as const }),
      health: async () => ({
        ok: true,
        status: "healthy" as const,
        open: true,
        healthy: true,
      }),
      request: async () => {
        throw new Error("should not be called for unimplemented stubs");
      },
      close: async () => {},
    } satisfies ServiceIpcClient;

    const client = createCollectorIpcClient(transport);

    await expect(client.listItems()).rejects.toMatchObject({
      name: "ServiceIpcError",
      layer: "validation",
      code: "unimplemented",
    });

    expect(() => client.getAppSettingsSync()).toThrow(ServiceIpcError);
    expect(() => client.getAppSettingsSync()).toThrow(/getAppSettingsSync/);

    expect(() => client.getVaultIndexSyncStatus()).toThrow(/not implemented/);

    await expect(client.ensureActiveVault()).rejects.toMatchObject({
      code: "unimplemented",
    });

    // Must not return null / [] / empty snapshot as a stand-in.
    expect(() =>
      client.peekMatchingDashboardSnapshot({
        vaultId: "v",
        filter: "all",
        search: "",
      }),
    ).toThrow(ServiceIpcError);
  });
});
