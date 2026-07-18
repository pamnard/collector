import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeFileSystemAdapter } from "../adapters/node-fs.js";
import {
  diskMtimeMsFromDocumentMarkdown,
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
    fs.touch = async (path: string) => {
      touchCalls.push(path);
      return originalTouch(path);
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
    fs.touch = async (path: string) => {
      touchCount += 1;
      touched = true;
      return originalTouch(path);
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
