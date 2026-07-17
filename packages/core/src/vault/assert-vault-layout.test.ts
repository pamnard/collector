import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { assertVaultTreeLayout } from "./assert-vault-layout.js";
import { legacyItemsRoot } from "./paths.js";

describe("assertVaultTreeLayout", () => {
  let vaultPath = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
      vaultPath = "";
    }
  });

  it("allows a tree-layout vault with no items/ directory", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-tree-ok-"));
    await writeFile(join(vaultPath, "note.md"), "---\ntitle: n\n---\n");
    await assertVaultTreeLayout(fs, vaultPath);
  });

  it("fails loud when legacy items/ is present", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-tree-legacy-"));
    await mkdir(legacyItemsRoot(vaultPath), { recursive: true });
    await expect(assertVaultTreeLayout(fs, vaultPath)).rejects.toThrow(
      /migrate-vault-layout/,
    );
  });
});
