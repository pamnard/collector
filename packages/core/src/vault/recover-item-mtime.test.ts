import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  diskMtimeMsFromDocumentMarkdown,
  ensureFileMtimeAdvanced,
  fileMtimeMsFromUpdatedAt,
  recoverItemDiskMtimeMs,
} from "./recover-item-mtime.js";

describe("recoverItemDiskMtimeMs", () => {
  let dir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("returns existing mtime without touching", async () => {
    dir = await mkdtemp(join(tmpdir(), "collector-recover-mtime-"));
    const docPath = join(dir, "item.md");
    await writeFile(docPath, "x", "utf8");
    const before = (await fs.stat(docPath)).mtimeMs;
    expect(before).not.toBeNull();

    const touchCalls: string[] = [];
    const originalTouch = fs.touch.bind(fs);
    fs.touch = async (path: string, mtimeMs?: number) => {
      touchCalls.push(path);
      return originalTouch(path, mtimeMs);
    };
    try {
      const recovered = await recoverItemDiskMtimeMs(fs, docPath);
      expect(recovered).toBe(before);
      expect(touchCalls).toEqual([]);
    } finally {
      fs.touch = originalTouch;
    }
  });

  it("touches once when mtime is null then returns healed mtime", async () => {
    dir = await mkdtemp(join(tmpdir(), "collector-recover-mtime-heal-"));
    const docPath = join(dir, "item.md");
    await writeFile(docPath, "x", "utf8");

    const originalStat = fs.stat.bind(fs);
    const originalTouch = fs.touch.bind(fs);
    let touched = false;
    let touchCount = 0;
    fs.stat = async (path: string) => {
      if (path === docPath && !touched) {
        return { mtimeMs: null };
      }
      return originalStat(path);
    };
    fs.touch = async (path: string, mtimeMs?: number) => {
      touchCount += 1;
      touched = true;
      return originalTouch(path, mtimeMs);
    };
    try {
      const recovered = await recoverItemDiskMtimeMs(fs, docPath);
      expect(touchCount).toBe(1);
      expect(recovered).not.toBeNull();
    } finally {
      fs.stat = originalStat;
      fs.touch = originalTouch;
    }
  });
});

describe("ensureFileMtimeAdvanced (#911)", () => {
  let dir = "";
  const fs = new NodeFileSystemAdapter();

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  it("returns current mtime when write already advanced it", async () => {
    dir = await mkdtemp(join(tmpdir(), "collector-ensure-mtime-ok-"));
    const docPath = join(dir, "item.md");
    await writeFile(docPath, "a", "utf8");
    const previous = (await fs.stat(docPath)).mtimeMs;
    expect(previous).not.toBeNull();
    await fs.touch(docPath, previous! + 10);
    const advanced = await ensureFileMtimeAdvanced(fs, docPath, previous!);
    expect(advanced).toBeGreaterThan(previous!);
  });

  it("forces mtime forward when rapid rewrite keeps the same stamp", async () => {
    dir = await mkdtemp(join(tmpdir(), "collector-ensure-mtime-stuck-"));
    const docPath = join(dir, "item.md");
    await writeFile(docPath, "a", "utf8");
    const pinned = 1_700_000_000_000;
    await fs.touch(docPath, pinned);
    expect((await fs.stat(docPath)).mtimeMs).toBe(pinned);
    // Rapid rewrite often retains mtime on this FS; pin then rewrite.
    await writeFile(docPath, "b", "utf8");

    const next = await ensureFileMtimeAdvanced(fs, docPath, pinned);
    expect(next).toBeGreaterThan(pinned);
    expect((await fs.stat(docPath)).mtimeMs).toBe(next);
  });
});

describe("fileMtimeMsFromUpdatedAt / diskMtimeMsFromDocumentMarkdown", () => {
  it("parses ISO updated_at", () => {
    expect(fileMtimeMsFromUpdatedAt("2024-01-02T03:04:05.000Z")).toBe(
      Date.parse("2024-01-02T03:04:05.000Z"),
    );
  });

  it("rejects invalid updated_at", () => {
    expect(() => fileMtimeMsFromUpdatedAt("not-a-date")).toThrow(/Invalid updated_at/);
  });

  it("derives mtime from document frontmatter", () => {
    const raw = `---
title: Hello
created_at: 2024-01-01T00:00:00.000Z
updated_at: 2024-06-15T12:00:00.000Z
---

body
`;
    expect(diskMtimeMsFromDocumentMarkdown(raw)).toBe(
      Date.parse("2024-06-15T12:00:00.000Z"),
    );
  });

  it("fails when document has no updated date", () => {
    const raw = `---
title: Hello
---

body
`;
    expect(() => diskMtimeMsFromDocumentMarkdown(raw)).toThrow(/missing updated/);
  });
});
