import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import {
  itemCoverPath,
  itemCoverRelativePath,
  itemCoverSizePath,
  itemMediaRoot,
  itemMarkdownPath,
  isUuidMarkdownBasename,
  joinSegments,
  noteSharedMediaRoot,
  noteUuidFromItemPath,
  vaultsRoot,
} from "./paths.js";

describe("joinSegments", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("preserves a leading slash and creates the joined path on disk", async () => {
    root = await mkdtemp(join(tmpdir(), "collector-paths-join-"));
    const vaults = joinSegments(root, "collector", "vaults");
    expect(vaults.startsWith("/")).toBe(true);
    await mkdir(vaults, { recursive: true });
    const lockPath = joinSegments(vaults, ".bootstrap.lock");
    await writeFile(lockPath, "locked", "utf8");
    expect(await readFile(lockPath, "utf8")).toBe("locked");
    expect(lockPath).toBe(`${vaults}/.bootstrap.lock`);
  });

  it("preserves absolute root when joining bootstrap lock (#181)", async () => {
    root = await mkdtemp(join(tmpdir(), "collector-paths-lock-"));
    const dataRoot = joinSegments(root, "home", ".local", "share", "com.collector.app", "collector");
    const vaults = vaultsRoot(dataRoot);
    const lockPath = joinSegments(vaults, ".bootstrap.lock");
    await mkdir(vaults, { recursive: true });
    await writeFile(lockPath, "ok", "utf8");
    expect(await readFile(lockPath, "utf8")).toBe("ok");
    expect(lockPath).toBe(`${dataRoot}/vaults/.bootstrap.lock`);
  });

  it("preserves Windows drive prefix as a path string", () => {
    expect(joinSegments("C:/Users/app/collector", "vaults", ".bootstrap.lock")).toBe(
      "C:/Users/app/collector/vaults/.bootstrap.lock",
    );
  });
});

describe("isUuidMarkdownBasename / noteUuidFromItemPath / media roots (#279)", () => {
  let vaultPath = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (vaultPath) {
      await rm(vaultPath, { recursive: true, force: true });
      vaultPath = "";
    }
  });

  it("accepts uuid.md on disk and rejects non-uuid peers", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-paths-uuid-"));
    const uuid = createId();
    const good = `${uuid}.md`;
    const badNote = "note.md";
    const badExt = `${uuid}.txt`;
    await writeFile(join(vaultPath, good), "# ok\n", "utf8");
    await writeFile(join(vaultPath, badNote), "# no\n", "utf8");
    await writeFile(join(vaultPath, badExt), "x", "utf8");

    const names = await fs.readDir(vaultPath);
    expect(names.filter(isUuidMarkdownBasename).sort()).toEqual([good]);
    expect(isUuidMarkdownBasename(badNote)).toBe(false);
    expect(isUuidMarkdownBasename(badExt)).toBe(false);
  });

  it("writes cover/media under paths derived from nested item id", async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "collector-paths-media-"));
    const uuid = createId();
    const itemId = `Work/${uuid}.md`;
    const docPath = itemMarkdownPath(vaultPath, itemId);
    await fs.mkdir(joinSegments(vaultPath, "Work"));
    await fs.writeText(docPath, "---\ntitle: Work\n---\n\nbody\n");

    expect(noteUuidFromItemPath(itemId)).toBe(uuid);
    expect(() => noteUuidFromItemPath("Inbox/note.md")).toThrow(/Item path must be <uuid>\.md/);
    expect(() => noteSharedMediaRoot(vaultPath, "note")).toThrow(/UUID/);

    const mediaRoot = itemMediaRoot(vaultPath, itemId);
    expect(mediaRoot).toBe(noteSharedMediaRoot(vaultPath, uuid));
    expect(mediaRoot).toBe(joinSegments(vaultPath, "media", uuid));

    await fs.mkdir(mediaRoot);
    const coverPath = itemCoverPath(vaultPath, itemId);
    const sizePath = itemCoverSizePath(vaultPath, itemId);
    await fs.writeBinary(coverPath, Uint8Array.from([1, 2, 3]));
    await fs.writeText(sizePath, '{"width":1,"height":1}');

    expect(await fs.exists(coverPath)).toBe(true);
    expect(await fs.exists(sizePath)).toBe(true);
    expect(itemCoverRelativePath(itemId)).toBe(`media/${uuid}/cover.webp`);
    expect(await readFile(coverPath)).toEqual(Buffer.from([1, 2, 3]));
    expect(await readFile(sizePath, "utf8")).toBe('{"width":1,"height":1}');
  });
});
