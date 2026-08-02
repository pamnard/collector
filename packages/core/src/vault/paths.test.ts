import { describe, expect, it } from "vitest";
import {
  itemCoverRelativePath,
  itemMediaRoot,
  isUuidMarkdownBasename,
  joinSegments,
  noteSharedMediaRoot,
  noteUuidFromItemPath,
  vaultsRoot,
} from "./paths.js";

describe("joinSegments", () => {
  it("preserves a leading slash on absolute Unix paths", () => {
    expect(joinSegments("/tmp/smoke/home/.local/share/com.collector.app/collector", "vaults")).toBe(
      "/tmp/smoke/home/.local/share/com.collector.app/collector/vaults",
    );
  });

  it("preserves absolute root when joining bootstrap lock (#181)", () => {
    const vaults = vaultsRoot(
      "/tmp/collector-release-smoke/home/.local/share/com.collector.app/collector",
    );
    expect(joinSegments(vaults, ".bootstrap.lock")).toBe(
      "/tmp/collector-release-smoke/home/.local/share/com.collector.app/collector/vaults/.bootstrap.lock",
    );
  });

  it("preserves Windows drive prefix", () => {
    expect(joinSegments("C:/Users/app/collector", "vaults", ".bootstrap.lock")).toBe(
      "C:/Users/app/collector/vaults/.bootstrap.lock",
    );
  });
});

describe("isUuidMarkdownBasename", () => {
  it("accepts uuid.md", () => {
    expect(
      isUuidMarkdownBasename("a1b2c3d4-e5f6-7890-abcd-ef1234567890.md"),
    ).toBe(true);
  });

  it("rejects non-uuid stems and non-markdown", () => {
    expect(isUuidMarkdownBasename("note.md")).toBe(false);
    expect(isUuidMarkdownBasename("a1b2c3d4-e5f6-7890-abcd-ef1234567890.txt")).toBe(
      false,
    );
  });
});

describe("noteSharedMediaRoot", () => {
  it("joins media/<uuid> under vault root", () => {
    const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(noteSharedMediaRoot("/vault", uuid)).toBe(`/vault/media/${uuid}`);
  });

  it("rejects non-uuid note ids", () => {
    expect(() => noteSharedMediaRoot("/vault", "note")).toThrow(/UUID/);
  });
});

describe("noteUuidFromItemPath / itemMediaRoot (#279)", () => {
  const uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("reads uuid stem from nested item path", () => {
    expect(noteUuidFromItemPath(`Inbox/${uuid}.md`)).toBe(uuid);
  });

  it("rejects non-uuid basenames", () => {
    expect(() => noteUuidFromItemPath("Inbox/note.md")).toThrow(
      /Item path must be <uuid>\.md/,
    );
  });

  it("points itemMediaRoot and cover relative path at media/<uuid>/", () => {
    const itemId = `Work/${uuid}.md`;
    expect(itemMediaRoot("/vault", itemId)).toBe(`/vault/media/${uuid}`);
    expect(itemCoverRelativePath(itemId)).toBe(`media/${uuid}/cover.webp`);
  });
});
