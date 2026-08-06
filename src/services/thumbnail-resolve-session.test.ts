/**
 * Host cover thumbnail bridge (#553).
 */

import { describe, expect, it, vi } from "vitest";
import { itemCoverPath } from "@collector/core";
import type { ItemFile } from "@collector/shared";
import {
  createHostCoverThumbnailSession,
  resolveHostCoverThumbnailPath,
} from "./thumbnail-resolve-session";

function stubItem(
  id: string,
  patch: Partial<ItemFile> = {},
): ItemFile {
  return { id, thumbnail: null, ...patch } as ItemFile;
}

describe("resolveHostCoverThumbnailPath (#553)", () => {
  it("returns remote FM thumbnail URLs", () => {
    expect(
      resolveHostCoverThumbnailPath("/vault", {
        id: "Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md",
        thumbnail: "https://cdn.example/a.jpg",
      }),
    ).toBe("https://cdn.example/a.jpg");
  });

  it("returns canonical cover.webp path without FS probe", () => {
    const id = "Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md";
    expect(resolveHostCoverThumbnailPath("/vault", { id, thumbnail: null })).toBe(
      itemCoverPath("/vault", id),
    );
  });
});

describe("createHostCoverThumbnailSession (#553)", () => {
  it("resolves cover paths via ensureActiveVault", async () => {
    const resolveActiveVault = vi.fn(async () => ({
      vault: { id: "v1", name: "V", created_at: "", updated_at: "" },
      path: "/vault",
    }));
    const session = createHostCoverThumbnailSession({ resolveActiveVault });
    const item = stubItem("Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md");
    const path = await session.resolveItemThumbnailPath(item);
    expect(resolveActiveVault).toHaveBeenCalled();
    expect(path).toBe(itemCoverPath("/vault", item.id));
  });
});
