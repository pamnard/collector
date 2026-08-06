import { describe, expect, it } from "vitest";
import {
  SERVICE_IPC_PROTOCOL_VERSION,
  ServiceIpcFrameReader,
  ServiceIpcFramingError,
  encodeServiceIpcFrame,
  type ServiceIpcRequest,
} from "./framing.js";
import { defaultServiceIpcPath, isWindowsNamedPipePath } from "./paths.js";

describe("IPC framing", () => {
  it("round-trips length-prefixed frames across chunk boundaries", () => {
    const req: ServiceIpcRequest = {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: "1",
      type: "req",
      method: "ping",
    };
    const frame = encodeServiceIpcFrame(req);
    const reader = new ServiceIpcFrameReader();

    expect(reader.push(frame.subarray(0, 2))).toEqual([]);
    expect(reader.push(frame.subarray(2, 6))).toEqual([]);
    const messages = reader.push(frame.subarray(6));
    expect(messages).toEqual([req]);
  });

  it("round-trips event frames", () => {
    const evt = {
      v: SERVICE_IPC_PROTOCOL_VERSION,
      id: "evt",
      type: "evt" as const,
      event: "vaultIndexSyncStatus",
      payload: { status: "running" },
    };
    const frame = encodeServiceIpcFrame(evt);
    const reader = new ServiceIpcFrameReader();
    expect(reader.push(frame)).toEqual([evt]);
  });

  it("rejects oversized frames", () => {
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(2 * 1024 * 1024, 0);
    const reader = new ServiceIpcFrameReader();
    expect(() => reader.push(header)).toThrow(ServiceIpcFramingError);
  });
});

describe("defaultServiceIpcPath", () => {
  it("uses a Unix socket under dataDir on non-Windows", () => {
    if (process.platform === "win32") {
      expect(isWindowsNamedPipePath(defaultServiceIpcPath("C:\\\\data"))).toBe(
        true,
      );
      return;
    }
    expect(defaultServiceIpcPath("/tmp/collector-data")).toBe(
      "/tmp/collector-data/collector-service.sock",
    );
  });
});
