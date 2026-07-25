import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDropImportService,
  resolveImportItemFolder,
} from "./drop-import.js";

describe("resolveImportItemFolder", () => {
  it("mirrors relative dirs under target", () => {
    expect(resolveImportItemFolder("Projects", "Trip/a.png")).toBe(
      "Projects/Trip",
    );
    expect(resolveImportItemFolder("Projects", "a.png")).toBe("Projects");
    expect(resolveImportItemFolder(undefined, "Trip/a.png")).toBe("Trip");
    expect(resolveImportItemFolder(undefined, "a.png")).toBeUndefined();
  });
});

describe("createDropImportService", () => {
  const createItem = vi.fn();
  const attachMediaFiles = vi.fn();
  const updateItemSource = vi.fn();

  beforeEach(() => {
    createItem.mockReset();
    attachMediaFiles.mockReset();
    updateItemSource.mockReset();
    createItem.mockImplementation(async (input: { title: string }) => ({
      id: `Inbox/${input.title}.md`,
      folder_path: "Inbox",
      title: input.title,
    }));
    attachMediaFiles.mockResolvedValue([]);
    updateItemSource.mockImplementation(async (id: string) => ({ id }));
  });

  function service() {
    return createDropImportService({
      createItem,
      attachMediaFiles,
      updateItemSource,
    });
  }

  it("imports png as image item with media", async () => {
    const result = await service().importDroppedFiles({
      files: [
        {
          relativePath: "shot.png",
          filename: "shot.png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "shot",
        content_type: "image",
        source_type: "import",
      }),
    );
    expect(attachMediaFiles).toHaveBeenCalledWith("Inbox/shot.md", [
      { filename: "shot.png", data: expect.any(Uint8Array) },
    ]);
    expect(result.createdIds).toEqual(["Inbox/shot.md"]);
  });

  it("imports markdown with frontmatter title then updateItemSource", async () => {
    const raw = "---\ntitle: From FM\n---\n\nHi\n";
    const data = new TextEncoder().encode(raw);

    const result = await service().importDroppedFiles({
      files: [
        {
          relativePath: "x.md",
          filename: "x.md",
          data,
        },
      ],
    });

    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "From FM",
        content_type: "note",
        source_type: "import",
      }),
    );
    expect(updateItemSource).toHaveBeenCalledWith(
      "Inbox/From FM.md",
      expect.stringContaining("content_type: note"),
    );
    expect(result.createdIds).toHaveLength(1);
  });

  it("skips unsupported files silently", async () => {
    const result = await service().importDroppedFiles({
      files: [
        {
          relativePath: "a.png",
          filename: "a.png",
          data: new Uint8Array([1]),
        },
        {
          relativePath: "bad.exe",
          filename: "bad.exe",
          data: new Uint8Array([2]),
        },
      ],
    });

    expect(createItem).toHaveBeenCalledTimes(1);
    expect(result.createdIds).toHaveLength(1);
  });

  it("places nested file under target folder", async () => {
    createItem.mockImplementation(async (input: { folder_path?: string }) => ({
      id: `${input.folder_path}/id.md`,
      folder_path: input.folder_path,
    }));

    await service().importDroppedFiles({
      folder_path: "Projects",
      files: [
        {
          relativePath: "Trip/a.png",
          filename: "a.png",
          data: new Uint8Array([1]),
        },
      ],
    });

    expect(createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        folder_path: "Projects/Trip",
        content_type: "image",
      }),
    );
  });
});
