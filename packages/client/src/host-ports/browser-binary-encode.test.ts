import { afterEach, describe, expect, it } from "vitest";
import type { HostWireClient } from "@collector/service/wire";
import { createHostSessionCtx } from "../host-session-ctx.js";
import { createHostItemsPort } from "./items.js";
import { createHostMediaPort } from "./media.js";

type RequestCall = { method: string; params: unknown };

function mockTransport(calls: RequestCall[]): HostWireClient {
  return {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "attachMediaFiles") return [];
      if (method === "replaceItemMedia") {
        return {
          id: "media-1",
          filename: "a.bin",
          media_type: "other",
          size: 3,
          created_at: "2020-01-01T00:00:00.000Z",
        };
      }
      if (method === "importDroppedFiles") {
        return { created_item_ids: [], errors: [] };
      }
      return null;
    },
    ping: async () => ({ ok: true as const, pong: true as const }),
    health: async () => ({
      ok: true,
      status: "healthy" as const,
      open: true,
      healthy: true,
    }),
    onEvent: () => () => {},
    close: async () => {},
  };
}

describe("binary encode without global Buffer (webview)", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  // Oracle while Node Buffer still exists; encode under test runs after delete.
  const expectedBase64 = Buffer.from(bytes).toString("base64");
  let savedBuffer: unknown;

  afterEach(() => {
    if (savedBuffer !== undefined) {
      Object.defineProperty(globalThis, "Buffer", {
        value: savedBuffer,
        configurable: true,
        writable: true,
      });
      savedBuffer = undefined;
    }
  });

  function removeGlobalBuffer(): void {
    savedBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    // WebKit has no Buffer; simulate that for the encode path.
    Reflect.deleteProperty(globalThis, "Buffer");
    expect((globalThis as { Buffer?: unknown }).Buffer).toBeUndefined();
  }

  it("attachMediaFiles encodes dataBase64 without Buffer", async () => {
    const calls: RequestCall[] = [];
    const media = createHostMediaPort(
      createHostSessionCtx(mockTransport(calls)),
    );
    removeGlobalBuffer();

    await media.attachMediaFiles("item-1", [{ name: "a.bin", bytes }]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("attachMediaFiles");
    const params = calls[0]!.params as {
      files: Array<{ filename: string; dataBase64: string }>;
    };
    expect(params.files[0]!.dataBase64).toBe(expectedBase64);
  });

  it("replaceItemMedia encodes dataBase64 without Buffer", async () => {
    const calls: RequestCall[] = [];
    const media = createHostMediaPort(
      createHostSessionCtx(mockTransport(calls)),
    );
    removeGlobalBuffer();

    await media.replaceItemMedia("item-1", "media-1", {
      name: "a.bin",
      bytes,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("replaceItemMedia");
    const params = calls[0]!.params as {
      file: { filename: string; dataBase64: string };
    };
    expect(params.file.dataBase64).toBe(expectedBase64);
  });

  it("importDroppedFiles encodes dataBase64 without Buffer", async () => {
    const calls: RequestCall[] = [];
    const items = createHostItemsPort(
      createHostSessionCtx(mockTransport(calls)),
    );
    removeGlobalBuffer();

    await items.importDroppedFiles({
      folder_path: null,
      files: [{ relativePath: "a.bin", name: "a.bin", bytes }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("importDroppedFiles");
    const params = calls[0]!.params as {
      files: Array<{ dataBase64: string }>;
    };
    expect(params.files[0]!.dataBase64).toBe(expectedBase64);
  });
});
