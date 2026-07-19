import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectServiceIpc } from "./client.js";
import {
  ServiceIpcError,
  getCollectorApiError,
  mapHandlerThrownToApiError,
  mapNodeIpcErrno,
  serviceIpcError,
} from "./errors.js";
import { encodeServiceIpcFrame } from "./framing.js";
import { startServiceIpcServer } from "./server.js";

describe("IPC error mapping helpers", () => {
  it("maps connect errno to not_connected", () => {
    const err = mapNodeIpcErrno(
      Object.assign(new Error("nope"), { code: "ECONNREFUSED" }),
      "connect",
    );
    expect(err).toBeInstanceOf(ServiceIpcError);
    expect(err.collectorError).toEqual({
      layer: "transport",
      code: "not_connected",
      message: "IPC connect failed: ECONNREFUSED",
    });
  });

  it("preserves thrown CollectorApiError from handlers", () => {
    const thrown = serviceIpcError({
      layer: "domain",
      code: "index_unhealthy",
      message: "index bad",
    });
    expect(mapHandlerThrownToApiError(thrown)).toEqual(thrown.collectorError);
  });

  it("maps unknown throws to domain failed", () => {
    expect(mapHandlerThrownToApiError(new Error("boom"))).toEqual({
      layer: "domain",
      code: "failed",
      message: "boom",
    });
  });
});

describe("IPC failure modes over the wire", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "collector-ipc-err-"));
    dirs.push(dir);
    return dir;
  }

  it("request timeout → transport timeout", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
    });

    try {
      const client = await connectServiceIpc(server.path);
      try {
        await expect(client.health({ timeoutMs: 50 })).rejects.toMatchObject({
          name: "ServiceIpcError",
          code: "timeout",
          layer: "transport",
        });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("AbortSignal → transport cancelled", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
    });

    try {
      const client = await connectServiceIpc(server.path);
      try {
        const ac = new AbortController();
        const pending = client.health({ signal: ac.signal });
        ac.abort();
        await expect(pending).rejects.toMatchObject({
          code: "cancelled",
          layer: "transport",
        });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("peer disconnect mid-request → transport disconnected", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () =>
          new Promise(() => {
            /* hang until socket dies */
          }),
      },
    });

    const client = await connectServiceIpc(server.path);
    const outcome = client.health({ timeoutMs: 5_000 }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await server.close();
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected disconnect failure");
    }
    expect(result.error).toBeInstanceOf(ServiceIpcError);
    expect(getCollectorApiError(result.error)?.code).toBe("disconnected");
    expect(getCollectorApiError(result.error)?.layer).toBe("transport");
  });

  it("closed client → not_connected", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () => ({
          ok: true,
          status: "healthy",
          open: true,
          healthy: true,
        }),
      },
    });

    try {
      const client = await connectServiceIpc(server.path);
      await client.close();
      await expect(client.ping()).rejects.toMatchObject({
        code: "not_connected",
        layer: "transport",
      });
    } finally {
      await server.close();
    }
  });

  it("connect to missing endpoint → not_connected", async () => {
    const missing = join(tempDir(), "missing.sock");
    await expect(connectServiceIpc(missing, { connectTimeoutMs: 500 })).rejects.toMatchObject({
      code: "not_connected",
      layer: "transport",
    });
  });

  it("domain error from handler is returned as err frame", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () => {
          throw serviceIpcError({
            layer: "domain",
            code: "index_unhealthy",
            message: "rebuild required",
          });
        },
      },
    });

    try {
      const client = await connectServiceIpc(server.path);
      try {
        await expect(client.health()).rejects.toMatchObject({
          layer: "domain",
          code: "index_unhealthy",
          message: "rebuild required",
        });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("unknown method → validation unknown_method", async () => {
    const server = await startServiceIpcServer({
      dataDir: tempDir(),
      handler: {
        ping: () => ({ ok: true, pong: true }),
        health: () => ({
          ok: true,
          status: "healthy",
          open: true,
          healthy: true,
        }),
      },
    });

    try {
      const result = await new Promise<{
        type: string;
        error?: { layer?: string; code?: string };
      }>((resolve, reject) => {
        const socket = createConnection({ path: server.path }, () => {
          socket.write(
            encodeServiceIpcFrame({
              v: 1,
              id: "u",
              type: "req",
              method: "nope" as never,
            }),
          );
        });
        let buf = Buffer.alloc(0);
        socket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length < 4) return;
          const len = buf.readUInt32BE(0);
          if (buf.length < 4 + len) return;
          resolve(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
          socket.end();
        });
        socket.on("error", reject);
      });

      expect(result).toMatchObject({
        type: "err",
        error: { layer: "validation", code: "unknown_method" },
      });
    } finally {
      await server.close();
    }
  });
});
