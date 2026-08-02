import { beforeEach, describe, expect, it, vi } from "vitest";

const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
const isTauri = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (...args: unknown[]) =>
    convertFileSrc(...(args as [string])),
  isTauri: () => isTauri(),
}));

import { toDisplayAssetSrc } from "./asset-src";

describe("toDisplayAssetSrc", () => {
  beforeEach(() => {
    convertFileSrc.mockClear();
    isTauri.mockReset();
    isTauri.mockReturnValue(true);
  });

  it("passes through http and /__dev/ URLs", () => {
    expect(toDisplayAssetSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(toDisplayAssetSrc("/__dev/thumb.jpg")).toBe("/__dev/thumb.jpg");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("uses convertFileSrc for disk paths in Tauri", () => {
    expect(toDisplayAssetSrc("/home/user/vault/cover.jpg")).toBe(
      "asset://localhost//home/user/vault/cover.jpg",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("/home/user/vault/cover.jpg");
  });

  it("does not call convertFileSrc outside Tauri (web DevMock)", () => {
    isTauri.mockReturnValue(false);
    expect(toDisplayAssetSrc("/dev-mock/vault/cover.jpg")).toBe(
      "/dev-mock/vault/cover.jpg",
    );
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
});
