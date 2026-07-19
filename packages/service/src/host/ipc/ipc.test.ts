import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectServiceIpc } from "./client.js";
import { startServiceIpcServer } from "./server.js";
import { SERVICE_IPC_PROTOCOL_VERSION } from "./framing.js";
import { createConnection } from "node:net";

describe("service IPC server/client", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dials health/ping over local IPC", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-"));
    dirs.push(dataDir);

    const server = await startServiceIpcServer({
      dataDir,
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
      try {
        expect(await client.ping()).toEqual({ ok: true, pong: true });
        expect(await client.health()).toMatchObject({
          ok: true,
          healthy: true,
          status: "healthy",
        });
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  });

  it("rejects protocol mismatch with transport error", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "collector-ipc-proto-"));
    dirs.push(dataDir);

    const server = await startServiceIpcServer({
      dataDir,
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
        error?: { code?: string };
      }>((resolve, reject) => {
        const socket = createConnection({ path: server.path }, () => {
          const body = Buffer.from(
            JSON.stringify({
              v: SERVICE_IPC_PROTOCOL_VERSION + 99,
              id: "x",
              type: "req",
              method: "ping",
            }),
            "utf8",
          );
          const header = Buffer.allocUnsafe(4);
          header.writeUInt32BE(body.length, 0);
          socket.write(Buffer.concat([header, body]));
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

      expect(result.type).toBe("err");
      expect(result.error?.code).toBe("protocol_mismatch");
    } finally {
      await server.close();
    }
  });
});
