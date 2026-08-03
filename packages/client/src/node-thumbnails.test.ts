import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveThumbnailCandidate } from "./node-thumbnails.js";

describe("resolveThumbnailCandidate (#383)", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), "collector-thumbs-"));
  });

  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it("returns null for null thumbnail", () => {
    expect(resolveThumbnailCandidate(vault, "item.md", null)).toBeNull();
  });

  it("returns abs path when file exists", async () => {
    const abs = join(vault, "cover.jpg");
    await writeFile(abs, "img");
    expect(resolveThumbnailCandidate(vault, "item.md", abs)).toBe(abs);
  });

  it("returns null for missing abs path", () => {
    const abs = join(vault, "missing.jpg");
    expect(resolveThumbnailCandidate(vault, "item.md", abs)).toBeNull();
  });

  it("resolves relative thumbnail under vault root", async () => {
    await writeFile(join(vault, "thumb.jpg"), "img");
    expect(
      resolveThumbnailCandidate(vault, "item.md", "thumb.jpg"),
    ).toBe(join(vault, "thumb.jpg"));
  });

  it("resolves relative thumbnail next to nested itemId folder", async () => {
    await mkdir(join(vault, "notes"), { recursive: true });
    await writeFile(join(vault, "notes", "thumb.jpg"), "img");
    expect(
      resolveThumbnailCandidate(vault, "notes/item.md", "thumb.jpg"),
    ).toBe(join(vault, "notes", "thumb.jpg"));
  });

  it("returns remote http thumbnail without requiring a local file", () => {
    const url = "https://example.com/cover.jpg";
    expect(resolveThumbnailCandidate(vault, "item.md", url)).toBe(url);
  });
});
