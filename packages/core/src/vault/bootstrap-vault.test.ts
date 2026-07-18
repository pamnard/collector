import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { readAppSettings } from "../settings/app-settings-io.js";
import {
  assertNoIncompleteVaultDirs,
  listIncompleteVaultDirIds,
  persistActiveVaultIdSetting,
  runEmptyVaultBootstrap,
  withVaultBootstrapLock,
} from "./bootstrap-vault.js";
import { vaultMetaPath, vaultRoot, vaultsRoot } from "./paths.js";

describe("bootstrap-vault", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("lists UUID dirs under vaults/ that lack vault.meta.json", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    const incompleteId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const completeId = "11111111-2222-3333-4444-555555555555";
    await fs.mkdir(vaultRoot(root, incompleteId));
    await fs.mkdir(vaultRoot(root, completeId));
    await fs.writeText(vaultMetaPath(vaultRoot(root, completeId)), "{}");
    await fs.writeText(join(root, "not-a-uuid"), "skip");

    const incomplete = await listIncompleteVaultDirIds(fs, root);
    expect(incomplete).toEqual([incompleteId]);
  });

  it("assertNoIncompleteVaultDirs throws when an incomplete dir exists", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    const incompleteId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await fs.mkdir(vaultRoot(root, incompleteId));

    await expect(assertNoIncompleteVaultDirs(fs, root)).rejects.toThrow(
      incompleteId,
    );
  });

  it("withVaultBootstrapLock runs exclusive work one at a time", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    await fs.mkdir(root);

    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withVaultBootstrapLock(fs, root, async () => {
      order.push("first-enter");
      await firstGate;
      order.push("first-exit");
      return 1;
    });

    await new Promise((r) => setTimeout(r, 20));

    const second = withVaultBootstrapLock(fs, root, async () => {
      order.push("second-enter");
      order.push("second-exit");
      return 2;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first-enter"]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual([
      "first-enter",
      "first-exit",
      "second-enter",
      "second-exit",
    ]);
  });

  it("runEmptyVaultBootstrap refuses incomplete dirs and does not create", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    const incompleteId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await fs.mkdir(vaultRoot(root, incompleteId));

    let created = false;
    await expect(
      runEmptyVaultBootstrap(fs, root, {
        tryResolveExisting: async () => null,
        create: async () => {
          created = true;
          return "new";
        },
      }),
    ).rejects.toThrow(incompleteId);
    expect(created).toBe(false);
  });

  it("empty bootstrap create persists active_vault_id", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    const configDir = join(dataDir, "config");
    await fs.mkdir(root);

    const vaultId = "11111111-2222-3333-4444-555555555555";
    const result = await runEmptyVaultBootstrap(fs, root, {
      tryResolveExisting: async () => null,
      create: async () => {
        await fs.mkdir(vaultRoot(root, vaultId));
        await fs.writeText(vaultMetaPath(vaultRoot(root, vaultId)), "{}");
        await persistActiveVaultIdSetting(fs, configDir, vaultId);
        return vaultId;
      },
    });

    expect(result).toBe(vaultId);
    const settings = await readAppSettings(fs, configDir);
    expect(settings?.active_vault_id).toBe(vaultId);
  });

  it("runEmptyVaultBootstrap skips create when another vault appears under lock", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-bootstrap-"));
    const root = vaultsRoot(dataDir);
    await fs.mkdir(root);

    const existingId = "11111111-2222-3333-4444-555555555555";
    let createCalls = 0;
    const result = await runEmptyVaultBootstrap(fs, root, {
      tryResolveExisting: async () => existingId,
      create: async () => {
        createCalls += 1;
        return "should-not-run";
      },
    });

    expect(result).toBe(existingId);
    expect(createCalls).toBe(0);
  });
});
