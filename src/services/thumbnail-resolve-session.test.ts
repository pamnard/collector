/**
 * DevMock thumbnail resolve session (#555).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemFile } from "@collector/shared";
import { createThumbnailResolveSession } from "./thumbnail-resolve-session";

vi.mock("../dev/is-dev-mock", () => ({
  isDevMock: vi.fn(() => true),
}));

vi.mock("../dev/mock-collector", () => ({
  resolveItemThumbnailPath: vi.fn(async (item: ItemFile) =>
    item.id ? `/mock/${item.id}` : null,
  ),
}));

import { isDevMock } from "../dev/is-dev-mock";
import * as devMockCollector from "../dev/mock-collector";

function stubItem(id: string): ItemFile {
  return { id, thumbnail: null } as ItemFile;
}

describe("createThumbnailResolveSession (DevMock)", () => {
  beforeEach(() => {
    vi.mocked(isDevMock).mockReturnValue(true);
    vi.mocked(devMockCollector.resolveItemThumbnailPath).mockClear();
  });

  it("resolves via mock collector", async () => {
    const session = createThumbnailResolveSession({
      resolveActiveVault: vi.fn(),
    });
    const item = stubItem("Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md");
    const path = await session.resolveItemThumbnailPath(item);
    expect(devMockCollector.resolveItemThumbnailPath).toHaveBeenCalledWith(item);
    expect(path).toBe(`/mock/${item.id}`);
  });

  it("throws outside DevMock", async () => {
    vi.mocked(isDevMock).mockReturnValue(false);
    const session = createThumbnailResolveSession({
      resolveActiveVault: vi.fn(),
    });
    await expect(
      session.resolveItemThumbnailPath(
        stubItem("Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md"),
      ),
    ).rejects.toThrow(/DevMock-only/);
  });
});
