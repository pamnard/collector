import { describe, expect, it } from "vitest";
import { parseVaultItemWatchPath } from "./vault-watch-path.js";

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
});
