import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import {
  classifyVaultWatchPath,
  parseSharedMediaNoteUuid,
  parseVaultItemWatchPath,
  resolveVaultItemWatchPath,
  resolveVaultWatchTarget,
} from "./vault-watch-path.js";
import { joinSegments } from "./paths.js";

describe("classifyVaultWatchPath (#567)", () => {
  const vaultRoot = "/vault/root";

  it("classifies markdown paths as items", () => {
    expect(classifyVaultWatchPath(vaultRoot, `${vaultRoot}/note.md`)).toEqual({
      kind: "item",
      itemId: "note.md",
    });
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/Inbox/note.md`),
    ).toEqual({ kind: "item", itemId: "Inbox/note.md" });
  });

  it("classifies media sidecar paths as items", () => {
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/note.media/cover.webp`),
    ).toEqual({ kind: "item", itemId: "note.md" });
  });

  it("classifies bare folder paths as folder prefixes", () => {
    expect(classifyVaultWatchPath(vaultRoot, `${vaultRoot}/Parent`)).toEqual({
      kind: "folder",
      folderPath: "Parent",
    });
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/Parent/Child`),
    ).toEqual({ kind: "folder", folderPath: "Parent/Child" });
  });

  it("ignores reserved entries, vault root, legacy items/, and non-md files", () => {
    expect(classifyVaultWatchPath(vaultRoot, `${vaultRoot}/vault.meta.json`)).toBe(
      null,
    );
    expect(classifyVaultWatchPath(vaultRoot, vaultRoot)).toBe(null);
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/items/abc/content.md`),
    ).toBe(null);
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/Inbox/notes.txt`),
    ).toBe(null);
  });

  it("does not sync-classify shared media/<uuid>/ (needs async resolve)", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(
      classifyVaultWatchPath(vaultRoot, `${vaultRoot}/media/${uuid}/shot.png`),
    ).toBe(null);
  });
});

describe("parseVaultItemWatchPath", () => {
  const vaultRoot = "/vault/root";

  it("returns the item id for a direct markdown change", () => {
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/note.md`)).toBe("note.md");
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/Inbox/note.md`)).toBe(
      "Inbox/note.md",
    );
  });

  it("maps media sidecar changes to the sibling .md item id", () => {
    expect(
      parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/note.media/cover.webp`),
    ).toBe("note.md");
    expect(
      parseVaultItemWatchPath(
        vaultRoot,
        `${vaultRoot}/Inbox/note.media/manifest.json`,
      ),
    ).toBe("Inbox/note.md");
  });

  it("ignores reserved top-level entries and the vault root itself", () => {
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/vault.meta.json`)).toBe(
      null,
    );
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/tags.json`)).toBe(null);
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/folders.json`)).toBe(null);
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/.collector-touch`)).toBe(
      null,
    );
    expect(parseVaultItemWatchPath(vaultRoot, vaultRoot)).toBe(null);
  });

  it("ignores legacy items/ tree entirely", () => {
    expect(
      parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/items/abc/content.md`),
    ).toBe(null);
  });

  it("returns null for paths outside the vault root", () => {
    expect(parseVaultItemWatchPath(vaultRoot, "/other/root/note.md")).toBe(null);
  });

  it("returns null for non-markdown files outside media dirs", () => {
    expect(parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/Inbox/notes.txt`)).toBe(
      null,
    );
  });

  it("does not sync-resolve shared media/<uuid>/ (needs async lookup)", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(
      parseVaultItemWatchPath(vaultRoot, `${vaultRoot}/media/${uuid}/shot.png`),
    ).toBe(null);
    expect(parseSharedMediaNoteUuid(`media/${uuid}/shot.png`)).toBe(uuid);
  });
});

describe("resolveVaultItemWatchPath (#279)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("maps media/<uuid>/file to nested **/uuid.md", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-media-"));
    const uuid = createId();
    const itemId = `Inbox/${uuid}.md`;
    await fs.mkdir(joinSegments(dataDir, "Inbox"));
    await fs.writeText(joinSegments(dataDir, itemId), "---\ntitle: n\n---\n");
    await fs.mkdir(joinSegments(dataDir, "media", uuid));
    await fs.writeBinary(
      joinSegments(dataDir, "media", uuid, "shot.png"),
      Uint8Array.from([1]),
    );

    await expect(
      resolveVaultItemWatchPath(
        fs,
        dataDir,
        joinSegments(dataDir, "media", uuid, "shot.png"),
      ),
    ).resolves.toBe(itemId);
  });
});

describe("resolveVaultWatchTarget (#567)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("resolves bare folders and shared media to watch targets", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-watch-target-"));
    const uuid = createId();
    const itemId = `Inbox/${uuid}.md`;
    await fs.mkdir(joinSegments(dataDir, "Inbox"));
    await fs.mkdir(joinSegments(dataDir, "Parent", "Child"));
    await fs.writeText(joinSegments(dataDir, itemId), "---\ntitle: n\n---\n");
    await fs.mkdir(joinSegments(dataDir, "media", uuid));
    await fs.writeBinary(
      joinSegments(dataDir, "media", uuid, "shot.png"),
      Uint8Array.from([1]),
    );

    await expect(
      resolveVaultWatchTarget(
        fs,
        dataDir,
        joinSegments(dataDir, "Parent", "Child"),
      ),
    ).resolves.toEqual({ kind: "folder", folderPath: "Parent/Child" });

    await expect(
      resolveVaultWatchTarget(
        fs,
        dataDir,
        joinSegments(dataDir, "media", uuid, "shot.png"),
      ),
    ).resolves.toEqual({ kind: "item", itemId });
  });
});
