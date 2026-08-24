import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ImportFolderFatalError,
  inferFatalCodeFromMessage,
  isFatalImportFolderError,
} from "./handlers/import-folder-fatal.js";
import {
  applyImportFolderFileOutcome,
  canonicalUrlFromNoteBytes,
  importOneFolderFile,
} from "./handlers/import-folder-file.js";
import {
  deriveImportFolderResultStatus,
  emptyMutableImportFolderResult,
  finalizeImportFolderResult,
  pushImportFolderFailureSample,
} from "./handlers/import-folder-result.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const readFileMock = vi.mocked(readFile);

describe("import-folder steps (#793)", () => {
  describe("fatal predicates", () => {
    it("treats typed ImportFolderFatalError as fatal", () => {
      expect(
        isFatalImportFolderError(
          new ImportFolderFatalError("sqlite_error", "boom"),
        ),
      ).toBe(true);
    });

    it("infers fatal codes from lower-layer messages", () => {
      expect(inferFatalCodeFromMessage("active vault mismatch")).toBe(
        "active_vault_mismatch",
      );
      expect(inferFatalCodeFromMessage("no active vault")).toBe(
        "no_active_vault",
      );
      expect(inferFatalCodeFromMessage("SQLITE_BUSY")).toBe("sqlite_error");
      expect(inferFatalCodeFromMessage("database is locked")).toBe(
        "sqlite_error",
      );
      expect(inferFatalCodeFromMessage("index is unavailable")).toBe(
        "index_unavailable",
      );
      expect(inferFatalCodeFromMessage("bad markdown")).toBeNull();
      expect(isFatalImportFolderError(new Error("bad markdown"))).toBe(false);
    });
  });

  describe("result helpers", () => {
    it("derives ok / partial / failed status", () => {
      expect(
        deriveImportFolderResultStatus(emptyMutableImportFolderResult()),
      ).toBe("ok");
      expect(
        deriveImportFolderResultStatus({
          createdIds: ["a"],
          skippedIds: [],
          failures: [],
          failedCount: 1,
        }),
      ).toBe("partial");
      expect(
        deriveImportFolderResultStatus({
          createdIds: [],
          skippedIds: [],
          failures: [{ relativePath: "x.md", error: "e" }],
          failedCount: 1,
        }),
      ).toBe("failed");
    });

    it("finalizeImportFolderResult can force failed status", () => {
      const finalized = finalizeImportFolderResult(
        {
          createdIds: ["a"],
          skippedIds: [],
          failures: [],
          failedCount: 0,
        },
        { forceStatus: "failed" },
      );
      expect(finalized.status).toBe("failed");
      expect(finalized.created).toBe(1);
    });

    it("caps failure samples", () => {
      const failures: Array<{ relativePath: string; error: string }> = [];
      for (let i = 0; i < 25; i += 1) {
        pushImportFolderFailureSample(failures, `f-${i}.md`, "err", 20);
      }
      expect(failures).toHaveLength(20);
    });
  });

  describe("file step helpers", () => {
    it("reads canonical url from note frontmatter", () => {
      const bytes = new TextEncoder().encode(
        "---\ntitle: T\nurl: https://example.com/n\n---\nbody\n",
      );
      expect(canonicalUrlFromNoteBytes(bytes)).toBe("https://example.com/n");
      expect(
        canonicalUrlFromNoteBytes(
          new TextEncoder().encode("---\ntitle: T\n---\n"),
        ),
      ).toBeNull();
    });

    it("applyImportFolderFileOutcome mutates accumulator", () => {
      const result = emptyMutableImportFolderResult();
      const file = {
        absPath: "source/a.md",
        relativePath: "a.md",
        name: "a.md",
      };
      applyImportFolderFileOutcome(result, file, { kind: "skipped_kind" });
      expect(result).toEqual(emptyMutableImportFolderResult());

      applyImportFolderFileOutcome(result, file, {
        kind: "skipped_existing",
        itemId: "Inbox/Existing.md",
      });
      applyImportFolderFileOutcome(result, file, {
        kind: "imported",
        createdIds: ["Inbox/A.md"],
      });
      applyImportFolderFileOutcome(result, file, {
        kind: "per_file_fail",
        error: "nope",
      });
      expect(result.skippedIds).toEqual(["Inbox/Existing.md"]);
      expect(result.createdIds).toEqual(["Inbox/A.md"]);
      expect(result.failedCount).toBe(1);
      expect(result.failures).toEqual([{ relativePath: "a.md", error: "nope" }]);
    });

    it("applyImportFolderFileOutcome rejects fatal (caller must handle)", () => {
      const result = emptyMutableImportFolderResult();
      const file = {
        absPath: "source/a.md",
        relativePath: "a.md",
        name: "a.md",
      };
      expect(() =>
        applyImportFolderFileOutcome(result, file, {
          kind: "fatal",
          error: "sqlite boom",
        }),
      ).toThrow(/fatal import outcome must be handled by caller/);
    });
  });

  describe("importOneFolderFile", () => {
    const file = {
      absPath: "source/note.md",
      relativePath: "note.md",
      name: "note.md",
    };
    const assertActiveVault = vi.fn();
    const findItemIdByUrl = vi.fn();
    const importDroppedFiles = vi.fn();

    beforeEach(() => {
      assertActiveVault.mockReset();
      findItemIdByUrl.mockReset();
      importDroppedFiles.mockReset();
      readFileMock.mockReset();
      assertActiveVault.mockResolvedValue(undefined);
      findItemIdByUrl.mockResolvedValue(null);
    });

    it("returns skipped_kind for non-importable filename", async () => {
      const outcome = await importOneFolderFile({
        file: { ...file, name: "readme.txt", relativePath: "readme.txt" },
        vaultId: "vault-1",
        folder_path: undefined,
        importer: { importDroppedFiles },
        assertActiveVault,
        findItemIdByUrl,
      });
      expect(outcome).toEqual({ kind: "skipped_kind" });
      expect(assertActiveVault).not.toHaveBeenCalled();
      expect(readFileMock).not.toHaveBeenCalled();
      expect(importDroppedFiles).not.toHaveBeenCalled();
    });

    it("returns skipped_existing when note url already indexed", async () => {
      readFileMock.mockResolvedValue(
        Buffer.from("---\nurl: https://example.com/n\n---\nbody\n"),
      );
      findItemIdByUrl.mockResolvedValue("Inbox/Existing.md");

      const outcome = await importOneFolderFile({
        file,
        vaultId: "vault-1",
        folder_path: "Inbox",
        importer: { importDroppedFiles },
        assertActiveVault,
        findItemIdByUrl,
      });

      expect(outcome).toEqual({
        kind: "skipped_existing",
        itemId: "Inbox/Existing.md",
      });
      expect(assertActiveVault).toHaveBeenCalledWith("vault-1");
      expect(findItemIdByUrl).toHaveBeenCalledWith(
        "vault-1",
        "https://example.com/n",
      );
      expect(importDroppedFiles).not.toHaveBeenCalled();
    });

    it("returns imported on successful drop import", async () => {
      readFileMock.mockResolvedValue(Buffer.from("---\ntitle: N\n---\n"));
      importDroppedFiles.mockResolvedValue({
        createdIds: ["Inbox/N.md"],
      });

      const outcome = await importOneFolderFile({
        file,
        vaultId: "vault-1",
        folder_path: "Inbox",
        importer: { importDroppedFiles },
        assertActiveVault,
        findItemIdByUrl,
      });

      expect(outcome).toEqual({
        kind: "imported",
        createdIds: ["Inbox/N.md"],
      });
      expect(importDroppedFiles).toHaveBeenCalledWith({
        folder_path: "Inbox",
        files: [
          {
            name: "note.md",
            relativePath: "note.md",
            bytes: expect.any(Uint8Array),
          },
        ],
      });
    });

    it("returns per_file_fail for non-fatal errors", async () => {
      readFileMock.mockResolvedValue(Buffer.from("---\ntitle: N\n---\n"));
      importDroppedFiles.mockRejectedValue(new Error("bad markdown"));

      const outcome = await importOneFolderFile({
        file,
        vaultId: "vault-1",
        folder_path: undefined,
        importer: { importDroppedFiles },
        assertActiveVault,
        findItemIdByUrl,
      });

      expect(outcome).toEqual({
        kind: "per_file_fail",
        error: "bad markdown",
      });
    });

    it("returns fatal for infrastructure errors", async () => {
      readFileMock.mockResolvedValue(Buffer.from("---\ntitle: N\n---\n"));
      importDroppedFiles.mockRejectedValue(
        new ImportFolderFatalError("sqlite_error", "SQLITE_BUSY"),
      );

      const outcome = await importOneFolderFile({
        file,
        vaultId: "vault-1",
        folder_path: undefined,
        importer: { importDroppedFiles },
        assertActiveVault,
        findItemIdByUrl,
      });

      expect(outcome).toEqual({
        kind: "fatal",
        error: "SQLITE_BUSY",
      });
    });
  });
});
