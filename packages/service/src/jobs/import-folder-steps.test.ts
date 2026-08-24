import { describe, expect, it } from "vitest";
import {
  ImportFolderFatalError,
  inferFatalCodeFromMessage,
  isFatalImportFolderError,
} from "./handlers/import-folder-fatal.js";
import {
  applyImportFolderFileOutcome,
  canonicalUrlFromNoteBytes,
} from "./handlers/import-folder-file.js";
import {
  deriveImportFolderResultStatus,
  emptyMutableImportFolderResult,
  finalizeImportFolderResult,
  pushImportFolderFailureSample,
} from "./handlers/import-folder-result.js";

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
        absPath: "/tmp/a.md",
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
  });
});
