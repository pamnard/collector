import { describe, expect, it, vi } from "vitest";
import {
  EXTRACT_MEDIA_MAX_BYTES,
  fetchExtractMediaBytes,
} from "./fetch-extract-media-bytes.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
/** Minimal ISO BMFF / MP4 header with ftyp. */
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00,
  0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
]);

function jsonResponse(
  status: number,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Response {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes, { status, headers });
}

describe("fetchExtractMediaBytes (#318)", () => {
  it("downloads image bytes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "image/jpeg" }),
    );
    const bytes = await fetchExtractMediaBytes("https://cdn.example/a.jpg", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bytes).toEqual(JPEG);
  });

  it("downloads video bytes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, MP4, { "content-type": "video/mp4" }),
    );
    const bytes = await fetchExtractMediaBytes("https://cdn.example/a.mp4", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bytes).toEqual(MP4);
  });

  it("rejects private / localhost hosts", async () => {
    await expect(
      fetchExtractMediaBytes("http://127.0.0.1/x.mp4"),
    ).rejects.toThrow(/blocked/);
  });

  it("rejects text/html content-type", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "text/html" }),
    );
    await expect(
      fetchExtractMediaBytes("https://cdn.example/page", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/unsupported Content-Type/);
  });

  it("rejects unrecognized magic", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, new Uint8Array([1, 2, 3, 4]), {
        "content-type": "application/octet-stream",
      }),
    );
    await expect(
      fetchExtractMediaBytes("https://cdn.example/bin", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not a recognized image\/video/);
  });

  it("rejects oversized content-length", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, {
        "content-type": "image/jpeg",
        "content-length": String(EXTRACT_MEDIA_MAX_BYTES + 1),
      }),
    );
    await expect(
      fetchExtractMediaBytes("https://cdn.example/big.jpg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxBytes: 16,
      }),
    ).rejects.toThrow(/exceeds limit/);
  });
});
