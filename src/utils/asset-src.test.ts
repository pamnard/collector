import { beforeEach, describe, expect, it, vi } from "vitest";

const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
const isTauri = vi.fn(() => true);

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (...args: unknown[]) =>
    convertFileSrc(...(args as [string])),
  isTauri: () => isTauri(),
}));

import { buildHostMediaFileUrl, toDisplayAssetSrc } from "./asset-src";

describe("toDisplayAssetSrc", () => {
  const env = import.meta.env as {
    VITE_COLLECTOR_SERVICE_BASE_URL?: string;
    VITE_COLLECTOR_SERVICE_TOKEN?: string;
  };

  beforeEach(() => {
    convertFileSrc.mockClear();
    isTauri.mockReset();
    isTauri.mockReturnValue(true);
    delete env.VITE_COLLECTOR_SERVICE_BASE_URL;
    delete env.VITE_COLLECTOR_SERVICE_TOKEN;
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

  it("maps disk paths to host /media/file when Vite host env is set (#553)", () => {
    isTauri.mockReturnValue(false);
    env.VITE_COLLECTOR_SERVICE_BASE_URL = "http://127.0.0.1:9876";
    env.VITE_COLLECTOR_SERVICE_TOKEN = "test-token";
    const src = toDisplayAssetSrc("/data/vaults/v1/media/id/cover.webp");
    expect(src).toBe(
      buildHostMediaFileUrl(
        "http://127.0.0.1:9876",
        "test-token",
        "/data/vaults/v1/media/id/cover.webp",
      ),
    );
    expect(src).toContain("/media/file?");
    expect(src).toContain("token=test-token");
    expect(convertFileSrc).not.toHaveBeenCalled();
  });
});

describe("buildHostMediaFileUrl", () => {
  it("encodes path and token as query params", () => {
    const url = buildHostMediaFileUrl(
      "http://127.0.0.1:9",
      "tok",
      "/vault/a b.webp",
    );
    expect(url.startsWith("http://127.0.0.1:9/media/file?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("path")).toBe("/vault/a b.webp");
    expect(parsed.searchParams.get("token")).toBe("tok");
  });
});
