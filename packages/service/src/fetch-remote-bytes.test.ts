import { describe, expect, it, vi } from "vitest";
import {
  REMOTE_DISPLAY_ASSET_MAX_BYTES,
  fetchRemoteBytes,
  type LookupHostAddresses,
} from "./fetch-remote-bytes.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** Fake public A record so offline tests never hit real DNS. */
const publicLookup: LookupHostAddresses = async () => ["93.184.216.34"];

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
      lookupAddresses: publicLookup,
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
    await expect(
      fetchRemoteBytes("http://[::1]/x.jpg"),
    ).rejects.toThrow(/blocked/);
    await expect(
      fetchRemoteBytes("http://[fe80::1]/x.jpg"),
    ).rejects.toThrow(/blocked/);
    await expect(
      fetchRemoteBytes("http://[fc00::1]/x.jpg"),
    ).rejects.toThrow(/blocked/);
    await expect(
      fetchRemoteBytes("http://[::ffff:127.0.0.1]/x.jpg"),
    ).rejects.toThrow(/blocked/);
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "image/jpeg" }),
    );
    await expect(
      fetchRemoteBytes("https://evil.example/a.jpg", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupAddresses: async () => ["10.0.0.8"],
      }),
    ).rejects.toThrow(/blocked address 10\.0\.0\.8/);
    expect(fetchImpl).not.toHaveBeenCalled();
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
        lookupAddresses: publicLookup,
        maxBytes: 16,
      }),
    ).rejects.toThrow(/exceeds limit/);
  });

  it("rejects unsupported content-type", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, JPEG, { "content-type": "text/html" }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/page", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow(/unsupported Content-Type/);
  });

  it("rejects bodies that are not image/video magic", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, new Uint8Array([1, 2, 3, 4]), {
        "content-type": "application/octet-stream",
      }),
    );
    await expect(
      fetchRemoteBytes("https://cdn.example/bin", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow(/not a recognized image\/video/);
  });

  it("downloads mp4 video bytes", async () => {
    const mp4 = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x00, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
    ]);
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, mp4, { "content-type": "video/mp4" }),
    );
    const bytes = await fetchRemoteBytes("https://cdn.example/a.mp4", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupAddresses: publicLookup,
    });
    expect(bytes).toEqual(mp4);
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
      lookupAddresses: publicLookup,
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
        lookupAddresses: publicLookup,
      }),
    ).rejects.toThrow(/blocked/);
  });

  it("blocks redirect whose hostname resolves to a private address", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("start")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.example/secret.jpg" },
        });
      }
      return jsonResponse(200, JPEG, { "content-type": "image/jpeg" });
    });
    const lookup: LookupHostAddresses = async (hostname) => {
      if (hostname === "internal.example") {
        return ["192.168.0.50"];
      }
      return ["93.184.216.34"];
    };
    await expect(
      fetchRemoteBytes("https://cdn.example/start", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        lookupAddresses: lookup,
      }),
    ).rejects.toThrow(/blocked address 192\.168\.0\.50/);
  });

  it("forwards custom headers and uses the error label", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init?.headers).toMatchObject({
        Referer: "https://x.com/",
        "User-Agent": "collector-test",
      });
      return jsonResponse(200, JPEG, { "content-type": "image/jpeg" });
    });
    await fetchRemoteBytes("https://cdn.example/a.jpg", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookupAddresses: publicLookup,
      headers: {
        Referer: "https://x.com/",
        "User-Agent": "collector-test",
      },
      label: "fetchExtractMediaBytes",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();

    await expect(
      fetchRemoteBytes("http://127.0.0.1/x.jpg", {
        label: "fetchExtractMediaBytes",
      }),
    ).rejects.toThrow(/^fetchExtractMediaBytes: blocked/);
  });
});
