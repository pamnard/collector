import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { vaultHasLegacyItemsLayout } from "./assert-vault-layout.js";
import { legacyItemsRoot } from "./paths.js";

describe("vaultHasLegacyItemsLayout", () => {
  let vaultPath = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
      vaultPath = "";
    }
  });

  it("is false when items/ is absent", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-tree-ok-"));
    expect(await vaultHasLegacyItemsLayout(fs, vaultPath)).toBe(false);
  });

  it("is true when legacy items/ is present (#277)", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-tree-legacy-"));
    await mkdir(legacyItemsRoot(vaultPath), { recursive: true });
    expect(await vaultHasLegacyItemsLayout(fs, vaultPath)).toBe(true);
  });
});
