import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  resolveByteRange,
  sendFileWithByteRange,
} from "./http-byte-range.ts";

describe("resolveByteRange", () => {
  it("returns full when Range header is absent", () => {
    assert.deepEqual(resolveByteRange(undefined, 1000), { kind: "full" });
  });

  it("returns full for malformed Range (ignore, serve whole file)", () => {
    assert.deepEqual(resolveByteRange("bytes", 1000), { kind: "full" });
    assert.deepEqual(resolveByteRange("bytes=abc", 1000), { kind: "full" });
    assert.deepEqual(resolveByteRange("foobar=0-1", 1000), { kind: "full" });
  });

  it("parses bytes=start-end inclusive", () => {
    assert.deepEqual(resolveByteRange("bytes=0-99", 1000), {
      kind: "partial",
      start: 0,
      end: 99,
    });
    assert.deepEqual(resolveByteRange("bytes=100-199", 1000), {
      kind: "partial",
      start: 100,
      end: 199,
    });
  });

  it("parses open-ended bytes=start-", () => {
    assert.deepEqual(resolveByteRange("bytes=500-", 1000), {
      kind: "partial",
      start: 500,
      end: 999,
    });
  });

  it("parses suffix bytes=-N", () => {
    assert.deepEqual(resolveByteRange("bytes=-200", 1000), {
      kind: "partial",
      start: 800,
      end: 999,
    });
  });

  it("clamps end to size-1 when end past EOF", () => {
    assert.deepEqual(resolveByteRange("bytes=0-9999", 1000), {
      kind: "partial",
      start: 0,
      end: 999,
    });
  });

  it("returns unsatisfiable when start past EOF", () => {
    assert.deepEqual(resolveByteRange("bytes=1000-", 1000), {
      kind: "unsatisfiable",
    });
    assert.deepEqual(resolveByteRange("bytes=1000-2000", 1000), {
      kind: "unsatisfiable",
    });
  });

  it("returns unsatisfiable for empty file with any bytes range", () => {
    assert.deepEqual(resolveByteRange("bytes=0-", 0), {
      kind: "unsatisfiable",
    });
  });

  it("ignores multi-range requests (serve full)", () => {
    assert.deepEqual(resolveByteRange("bytes=0-10,20-30", 1000), {
      kind: "full",
    });
  });
});

describe("sendFileWithByteRange HTTP", () => {
  it("serves Accept-Ranges on full GET and 206 body for mid-file Range", async () => {
    const dir = await mkdtemp(join(tmpdir(), "collector-range-"));
    const filePath = join(dir, "clip.mp4");
    const payload = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
    await writeFile(filePath, payload);

    const server = createServer((req, res) => {
      sendFileWithByteRange(req, res, filePath, payload.length, "video/mp4");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected TCP listen address");
    }
    const base = `http://127.0.0.1:${address.port}/clip.mp4`;

    const full = await fetch(base);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-length"), String(payload.length));
    assert.equal(Buffer.compare(Buffer.from(await full.arrayBuffer()), payload), 0);

    const mid = await fetch(base, {
      headers: { Range: "bytes=10-19" },
    });
    assert.equal(mid.status, 206);
    assert.equal(mid.headers.get("accept-ranges"), "bytes");
    assert.equal(mid.headers.get("content-range"), `bytes 10-19/${payload.length}`);
    assert.equal(mid.headers.get("content-length"), "10");
    assert.equal(
      Buffer.compare(
        Buffer.from(await mid.arrayBuffer()),
        payload.subarray(10, 20),
      ),
      0,
    );

    const openEnded = await fetch(base, {
      headers: { Range: `bytes=${Math.floor(payload.length / 2)}-` },
    });
    assert.equal(openEnded.status, 206);
    const half = Math.floor(payload.length / 2);
    assert.equal(
      openEnded.headers.get("content-range"),
      `bytes ${half}-${payload.length - 1}/${payload.length}`,
    );

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(dir, { recursive: true, force: true });
  });
});
