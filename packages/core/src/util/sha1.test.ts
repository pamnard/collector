import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha1Bytes } from "./sha1.js";

function nodeSha1(parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha1");
  for (const part of parts) {
    hash.update(part);
  }
  return new Uint8Array(hash.digest());
}

describe("sha1Bytes", () => {
  it("matches node:crypto for short input", () => {
    const parts = [new TextEncoder().encode("abc")];
    expect(sha1Bytes(parts)).toEqual(nodeSha1(parts));
  });

  it("matches node:crypto for messages longer than 55 bytes", () => {
    const itemId = `Inbox/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.md`;
    const filename = "shot.png";
    const parts = [
      new Uint8Array(16).fill(0x11),
      new TextEncoder().encode(`${itemId}\0${filename}`),
    ];
    expect(parts.reduce((n, p) => n + p.length, 0)).toBeGreaterThan(55);
    expect(sha1Bytes(parts)).toEqual(nodeSha1(parts));
  });

  it("matches node:crypto across a padding boundary (55 and 56 bytes)", () => {
    for (const len of [54, 55, 56, 57, 63, 64, 65]) {
      const parts = [new Uint8Array(len).fill(0x5a)];
      expect(sha1Bytes(parts), `len=${len}`).toEqual(nodeSha1(parts));
    }
  });
});
