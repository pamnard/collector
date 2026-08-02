import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { createId } from "../util/ids.js";
import {
  bareMediaFileId,
  listMediaFiles,
  mediaFilePath,
  mediaStoredFilename,
} from "./media-io.js";
import {
  itemCoverPath,
  itemMediaManifestPath,
  itemMediaRoot,
  itemSourcePath,
  joinSegments,
  noteUuidFromItemPath,
} from "./paths.js";

describe("media-io directory listing (#279)", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
      dataDir = "";
    }
  });

  it("lists attach-prefixed and bare files; skips cover/source/manifest/dotfiles", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "collector-media-io-"));
    const vaultPath = dataDir;
    const uuid = createId();
    const itemId = `Inbox/${uuid}.md`;
    const root = itemMediaRoot(vaultPath, itemId);
    await fs.mkdir(root);

    const mediaId = createId();
    const attachedName = mediaStoredFilename(mediaId, "photo.png");
    await fs.writeBinary(
      joinSegments(root, attachedName),
      Uint8Array.from([1, 2, 3]),
    );
    await fs.writeBinary(
      joinSegments(root, "shot.png"),
      Uint8Array.from([9, 8, 7]),
    );
    await fs.writeBinary(itemCoverPath(vaultPath, itemId), Uint8Array.from([4]));
    await fs.writeText(itemSourcePath(vaultPath, itemId), "{}");
    await fs.writeText(itemMediaManifestPath(vaultPath, itemId), '{"files":[]}');
    await fs.writeText(joinSegments(root, ".hidden"), "x");

    const listed = await listMediaFiles(fs, vaultPath, itemId);
    expect(listed.map((f) => f.filename).sort()).toEqual(["photo.png", "shot.png"]);

    const bare = listed.find((f) => f.filename === "shot.png")!;
    expect(bare.id).toBe(bareMediaFileId(itemId, "shot.png"));
    expect(bare.id).toBe(bareMediaFileId(itemId, "shot.png"));
    expect(
      mediaFilePath(vaultPath, itemId, bare.id, bare.filename),
    ).toBe(joinSegments(root, "shot.png"));

    const attached = listed.find((f) => f.filename === "photo.png")!;
    expect(attached.id).toBe(mediaId);
    expect(mediaFilePath(vaultPath, itemId, attached.id, attached.filename)).toBe(
      joinSegments(root, attachedName),
    );

    expect(root).toBe(joinSegments(vaultPath, "media", noteUuidFromItemPath(itemId)));
  });
});
