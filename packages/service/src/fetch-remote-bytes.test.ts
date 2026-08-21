import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_DISPLAY_ASSET_MAX_BYTES,
  fetchRemoteBytes,
} from "./fetch-remote-bytes.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function jsonResponse(
  status: number,
  body: Uint8Array | string,
  headers: Record<string, string> = {},
): Response {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes, { status, headers });
}

describe("fetchRemoteBytes (#739)", () => {
  it("downloads image bytes within limit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "image/jpeg" }),
    );
    const bytes = await fetchRemoteBytes("https://cdn.example/a.jpg", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bytes).toEqual(JPEG);
  });

  it("rejects private / localhost hosts", async () => {
    await expect(
      fetchRemoteBytes("http://127.0.0.1/x.jpg"),
    ).rejects.toThrow(/blocked/);
    await expect(
      fetchRemoteBytes("http://192.168.1.1/x.jpg"),
    ).rejects.toThrow(/blocked/);
    await expect(
      fetchRemoteBytes("http://localhost/x.jpg"),
    ).rejects.toThrow(/blocked/);
  });

  it("rejects non-http schemes", async () => {
    await expect(fetchRemoteBytes("file:///etc/passwd")).rejects.toThrow(
      /only http/,
    );
  });

  it("rejects oversized content-length", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, {
        "content-type": "image/jpeg",
        "content-length": String(REMOTE_DISPLAY_ASSET_MAX_BYTES + 1),
      }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/big.jpg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxBytes: 16,
      }),
    ).rejects.toThrow(/exceeds limit/);
  });

  it("rejects non-image content-type", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "text/html" }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/page", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/non-image Content-Type/);
  });

  it("rejects bodies that are not image magic", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, new Uint8Array([1, 2, 3, 4]), {
        "content-type": "application/octet-stream",
      }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/bin", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/not a recognized image/);
  });

  it("follows redirects only to allowed hosts", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/final.jpg" },
        });
      }
      return jsonResponse(200, JPEG, { "content-type": "image/jpeg" });
    });
    const bytes = await fetchRemoteBytes("https://cdn.example/start", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(bytes).toEqual(JPEG);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("blocks redirect into private network", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/secret.jpg" },
      }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/start", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/blocked/);
  });
});
