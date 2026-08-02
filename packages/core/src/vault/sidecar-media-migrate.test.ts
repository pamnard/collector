import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INBOX_FOLDER_NAME } from "@collector/shared";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import { MemorySqlAdapter } from "../testing/memory-sql.js";
import { createId } from "../util/ids.js";
import { SqlVaultIndexStore } from "../index/sql-index.js";
import { createVault } from "./vault-operations.js";
import {
  migrateSidecarMediaToShared,
  preflightSidecarMediaMigrate,
} from "./sidecar-media-migrate.js";
import {
  isUuidMarkdownBasename,
  itemMarkdownPath,
  joinSegments,
  noteSharedMediaRoot,
} from "./paths.js";

describe("sidecar-media-migrate", () => {
  let dataDir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    dataDir = "";
  });

  async function seedVault() {
    dataDir = await mkdtemp(join(tmpdir(), "collector-sidecar-migrate-"));
    const sql = new MemorySqlAdapter();
    const ctx = { fs, index: new SqlVaultIndexStore(sql) };
    const { meta, path } = await createVault(ctx, dataDir, { name: "Vault" });
    return { ctx, meta, path };
  }

  it("moves paired sidecars to media/<uuid>/ and root notes into Inbox", async () => {
    const { path } = await seedVault();
    const workUuid = createId();
    await fs.mkdir(joinSegments(path, "Work"));
    const workBody = "---\ntitle: Work note\n---\n\nkeep body\n";
    await fs.writeText(
      joinSegments(path, "Work", `${workUuid}.md`),
      workBody,
    );
    await fs.mkdir(joinSegments(path, "Work", `${workUuid}.media`));
    await fs.writeBinary(
      joinSegments(path, "Work", `${workUuid}.media`, "a.bin"),
      new Uint8Array([1, 2, 3]),
    );

    const rootBody = "---\ntitle: Old Title\n---\n\nroot body\n";
    await fs.writeText(joinSegments(path, "Old Title.md"), rootBody);
    await fs.mkdir(joinSegments(path, "Old Title.media"));
    await fs.writeBinary(
      joinSegments(path, "Old Title.media", "pic.png"),
      new Uint8Array([9, 9]),
    );

    const report = await migrateSidecarMediaToShared(fs, path);
    expect(report.sidecarsMigrated).toBe(2);
    expect(report.filesMoved).toBe(2);
    expect(report.notesRenamedToUuid).toBe(1);
    expect(report.orphans).toEqual([]);

    expect(
      await fs.exists(joinSegments(path, "Work", `${workUuid}.media`)),
    ).toBe(false);
    expect(
      await fs.exists(joinSegments(noteSharedMediaRoot(path, workUuid), "a.bin")),
    ).toBe(true);
    expect(await fs.readText(joinSegments(path, "Work", `${workUuid}.md`))).toBe(
      workBody,
    );

    expect(await fs.exists(joinSegments(path, "Old Title.md"))).toBe(false);
    expect(await fs.exists(joinSegments(path, "Old Title.media"))).toBe(false);

    const inboxEntries = await fs.readDir(joinSegments(path, INBOX_FOLDER_NAME));
    const inboxMd = inboxEntries.filter((n) => n.endsWith(".md"));
    expect(inboxMd).toHaveLength(1);
    expect(isUuidMarkdownBasename(inboxMd[0]!)).toBe(true);
    const rootUuid = inboxMd[0]!.slice(0, -3);
    expect(
      await fs.exists(joinSegments(noteSharedMediaRoot(path, rootUuid), "pic.png")),
    ).toBe(true);
    expect(
      await fs.readText(itemMarkdownPath(path, `${INBOX_FOLDER_NAME}/${inboxMd[0]}`)),
    ).toBe(rootBody);
  });

  it("second migrate is a no-op on already-converted vault", async () => {
    const { path } = await seedVault();
    const uuid = createId();
    await fs.mkdir(joinSegments(path, "Work"));
    await fs.writeText(
      joinSegments(path, "Work", `${uuid}.md`),
      "---\ntitle: N\n---\n\n",
    );
    await fs.mkdir(joinSegments(path, "Work", `${uuid}.media`));
    await fs.writeBinary(
      joinSegments(path, "Work", `${uuid}.media`, "a.bin"),
      new Uint8Array([1]),
    );

    await migrateSidecarMediaToShared(fs, path);
    const second = await migrateSidecarMediaToShared(fs, path);
    expect(second.sidecarsMigrated).toBe(0);
    expect(second.filesMoved).toBe(0);
    expect(second.notesRenamedToUuid).toBe(0);
    expect(
      await fs.exists(joinSegments(noteSharedMediaRoot(path, uuid), "a.bin")),
    ).toBe(true);
  });

  it("leaves orphan sidecars and reports them", async () => {
    const { path } = await seedVault();
    await fs.mkdir(joinSegments(path, "lonely.media"));
    await fs.writeText(joinSegments(path, "lonely.media", "x.txt"), "x");

    const preflight = await preflightSidecarMediaMigrate(fs, path);
    expect(preflight.orphanSidecars).toContain("lonely.media");
    expect(preflight.pairedSidecars).toEqual([]);

    const report = await migrateSidecarMediaToShared(fs, path);
    expect(report.orphans).toContain("lonely.media");
    expect(report.sidecarsMigrated).toBe(0);
    expect(await fs.exists(joinSegments(path, "lonely.media", "x.txt"))).toBe(
      true,
    );
  });

  it("uses collision-safe names inside media/<uuid>/", async () => {
    const { path } = await seedVault();
    const uuid = createId();
    await fs.mkdir(joinSegments(path, "Work"));
    await fs.writeText(
      joinSegments(path, "Work", `${uuid}.md`),
      "---\ntitle: N\n---\n\n",
    );
    await fs.mkdir(noteSharedMediaRoot(path, uuid));
    await fs.writeBinary(
      joinSegments(noteSharedMediaRoot(path, uuid), "a.bin"),
      new Uint8Array([7]),
    );
    await fs.mkdir(joinSegments(path, "Work", `${uuid}.media`));
    await fs.writeBinary(
      joinSegments(path, "Work", `${uuid}.media`, "a.bin"),
      new Uint8Array([8]),
    );

    const report = await migrateSidecarMediaToShared(fs, path);
    expect(report.filesMoved).toBe(1);
    expect(
      await fs.exists(joinSegments(noteSharedMediaRoot(path, uuid), "a.bin")),
    ).toBe(true);
    expect(
      await fs.exists(
        joinSegments(noteSharedMediaRoot(path, uuid), "a (2).bin"),
      ),
    ).toBe(true);
    expect(
      await fs.exists(joinSegments(path, "Work", `${uuid}.media`)),
    ).toBe(false);
  });
});
