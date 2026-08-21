import { beforeEach, describe, expect, it } from "vitest";
import {
  buildHostMediaFileUrl,
  clearHostMediaCredentials,
  setHostMediaCredentials,
  toDisplayAssetSrc,
} from "./asset-src";

describe("toDisplayAssetSrc (#739)", () => {
  const env = import.meta.env as {
    VITE_COLLECTOR_SERVICE_BASE_URL?: string;
    VITE_COLLECTOR_SERVICE_TOKEN?: string;
  };

  beforeEach(() => {
    clearHostMediaCredentials();
    delete env.VITE_COLLECTOR_SERVICE_BASE_URL;
    delete env.VITE_COLLECTOR_SERVICE_TOKEN;
  });

  it("passes through blob, data, and /__dev/ URLs", () => {
    expect(toDisplayAssetSrc("blob:https://x/1")).toBe("blob:https://x/1");
    expect(toDisplayAssetSrc("data:image/png;base64,xx")).toBe(
      "data:image/png;base64,xx",
    );
    expect(toDisplayAssetSrc("/__dev/thumb.jpg")).toBe("/__dev/thumb.jpg");
  });

  it("rejects remote http(s) display assets without throwing", () => {
    expect(toDisplayAssetSrc("https://example.com/a.png")).toBe("");
    expect(
      toDisplayAssetSrc("https://img.youtube.com/vi/abc/mqdefault.jpg"),
    ).toBe("");
  });

  it("returns disk paths unchanged without host credentials (DevMock)", () => {
    expect(toDisplayAssetSrc("/dev-mock/vault/cover.jpg")).toBe(
      "/dev-mock/vault/cover.jpg",
    );
  });

  it("maps disk paths to host /media/file when Vite host env is set (#553)", () => {
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
  });

  it("maps disk paths using runtime credentials from ui-bootstrap (#555)", () => {
    setHostMediaCredentials("http://127.0.0.1:4455", "boot-token");
    const src = toDisplayAssetSrc("/vault/cover.webp");
    expect(src).toBe(
      buildHostMediaFileUrl(
        "http://127.0.0.1:4455",
        "boot-token",
        "/vault/cover.webp",
      ),
    );
  });

  it("allows already-built host /media/file URLs", () => {
    setHostMediaCredentials("http://127.0.0.1:4455", "boot-token");
    const media = buildHostMediaFileUrl(
      "http://127.0.0.1:4455",
      "boot-token",
      "/vault/cover.webp",
    );
    expect(toDisplayAssetSrc(media)).toBe(media);
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
