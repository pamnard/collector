import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./bytes-to-base64.js";

describe("bytesToBase64", () => {
  it("matches Buffer base64 for ascii bytes", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("matches Buffer base64 for binary incl. high bytes", () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes empty input", () => {
    expect(bytesToBase64(new Uint8Array())).toBe("");
  });

  it("handles payloads larger than chunk size", () => {
    const bytes = new Uint8Array(0x8000 + 17);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i % 256;
    }
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});
