import { beforeEach, describe, expect, it } from "vitest";
import {
  buildHostMediaFileUrl,
  clearHostMediaCredentials,
  setHostMediaCredentials,
} from "../../utils/asset-src";
import { resolveMarkdownImageSrc } from "./MarkdownImage";

describe("resolveMarkdownImageSrc (#590 / #739)", () => {
  beforeEach(() => {
    clearHostMediaCredentials();
  });

  it("returns empty src for remote https images (#739)", () => {
    expect(resolveMarkdownImageSrc("https://example.com/a.png")).toBe("");
  });

  it("maps disk paths to host /media/file when credentials are set", () => {
    setHostMediaCredentials("http://127.0.0.1:4455", "boot-token");
    const src = resolveMarkdownImageSrc("/vault/note.media/a.png");
    expect(src).toBe(
      buildHostMediaFileUrl(
        "http://127.0.0.1:4455",
        "boot-token",
        "/vault/note.media/a.png",
      ),
    );
    expect(src).toContain("/media/file?");
  });
});
