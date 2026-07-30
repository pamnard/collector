import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeFileSystemAdapter } from "./node-fs-adapter.js";

describe("createNodeFileSystemAdapter (#383)", () => {
  let root: string;
  const fs = createNodeFileSystemAdapter();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "collector-node-fs-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writeText creates parents and readText round-trips", async () => {
    const path = join(root, "nested", "a", "file.txt");
    await fs.writeText(path, "hello");
    expect(await fs.readText(path)).toBe("hello");
    expect(await fs.exists(path)).toBe(true);
  });

  it("writeTextExclusive fails on second write", async () => {
    const path = join(root, "exclusive.txt");
    await fs.writeTextExclusive(path, "once");
    await expect(fs.writeTextExclusive(path, "twice")).rejects.toThrow();
    expect(await fs.readText(path)).toBe("once");
  });

  it("stat missing path returns mtimeMs null", async () => {
    expect(await fs.stat(join(root, "missing.bin"))).toEqual({
      mtimeMs: null,
    });
  });

  it("touch updates mtime", async () => {
    const path = join(root, "touch-me.txt");
    await writeFile(path, "x", "utf8");
    const before = await fs.stat(path);
    expect(before.mtimeMs).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    await fs.touch(path);
    const after = await fs.stat(path);
    expect(after.mtimeMs).not.toBeNull();
    expect(after.mtimeMs!).toBeGreaterThanOrEqual(before.mtimeMs!);
  });

  it("readDirEntries distinguishes files vs dirs", async () => {
    await mkdir(join(root, "subdir"), { recursive: true });
    await writeFile(join(root, "file.txt"), "y", "utf8");
    const entries = await fs.readDirEntries(root);
    const byName = new Map(entries.map((e) => [e.name, e.isDirectory]));
    expect(byName.get("subdir")).toBe(true);
    expect(byName.get("file.txt")).toBe(false);
  });

  it("remove deletes recursively", async () => {
    const nested = join(root, "tree", "leaf.txt");
    await fs.writeText(nested, "z");
    await fs.remove(join(root, "tree"));
    expect(await fs.exists(join(root, "tree"))).toBe(false);
  });
});
