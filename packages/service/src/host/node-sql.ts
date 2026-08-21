/**
 * Node host SQLite adapter (#151 / #749).
 *
 * Isolation note: a Promise-returning SqlExecutor is not non-blocking by itself.
 * better-sqlite3 prepare/run/all are synchronous. This class isolates them in a
 * dedicated worker_threads Worker so the host UI/RPC event loop stays responsive.
 * One worker (and one native DB connection) per opened DB file.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ClosableSqlExecutor } from "../index-boot.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerErrorPayload = {
  message: string;
  name: string;
  stack?: string;
};

type WorkerResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: WorkerErrorPayload };

function workerScriptUrl(): URL {
  const url = new URL("./node-sql-worker.mjs", import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) {
    throw new Error(
      `SQLite worker script not found at ${path} (build must copy node-sql-worker.mjs into dist/host)`,
    );
  }
  return url;
}

function reconstructWorkerError(payload: WorkerErrorPayload): Error {
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.message !== "string" ||
    typeof payload.name !== "string"
  ) {
    throw new Error(
      "NodeSqliteExecutor: malformed worker error payload (expected { message, name, stack? })",
    );
  }
  const err = new Error(payload.message);
  err.name = payload.name;
  if (typeof payload.stack === "string") {
    err.stack = payload.stack;
  }
  return err;
}

export class NodeSqliteExecutor implements ClosableSqlExecutor {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;

  private constructor(worker: Worker) {
    this.#worker = worker;
    worker.on("message", (msg: WorkerResponse) => {
      const pending = this.#pending.get(msg.id);
      if (!pending) {
        console.error("[node-sql] response for unknown pending id", {
          id: msg.id,
          ok: msg.ok,
        });
        throw new Error(
          `NodeSqliteExecutor: response for unknown pending id ${msg.id}`,
        );
      }
      this.#pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
        return;
      }
      pending.reject(reconstructWorkerError(msg.error));
    });
    worker.on("error", (err) => {
      this.#closed = true;
      this.#failAll(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on("exit", (code) => {
      if (this.#closed) {
        return;
      }
      this.#closed = true;
      this.#failAll(
        new Error(`SQLite worker exited unexpectedly (code ${code})`),
      );
    });
  }

  /** Test-only: observe worker lifecycle / teardown. */
  get workerForTests(): Worker {
    return this.#worker;
  }

  static async open(path: string): Promise<NodeSqliteExecutor> {
    const worker = new Worker(workerScriptUrl());
    const executor = new NodeSqliteExecutor(worker);
    try {
      await executor.#request("open", { path });
      return executor;
    } catch (err) {
      console.error("[node-sql] open failed; terminating worker", {
        path,
        err,
      });
      await executor.#terminateWorker();
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    return this.#request<number>("execute", {
      query,
      bind: bindValues,
    });
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    return this.#request<T[]>("select", {
      query,
      bind: bindValues,
    });
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#isWorkerDead()) {
      this.#failAll(new Error("SQLite worker exited unexpectedly"));
      return;
    }
    try {
      await this.#request("close", {});
    } finally {
      if (!this.#isWorkerDead()) {
        await this.#worker.terminate();
      }
      this.#failAll(new Error("NodeSqliteExecutor is closed"));
    }
  }

  #isWorkerDead(): boolean {
    return this.#worker.threadId === -1;
  }

  #request<T = unknown>(
    op: "open" | "execute" | "select" | "close",
    fields: Record<string, unknown>,
  ): Promise<T> {
    if (this.#closed && op !== "close") {
      return Promise.reject(new Error("NodeSqliteExecutor is closed"));
    }
    if (this.#isWorkerDead()) {
      return Promise.reject(
        new Error("SQLite worker exited unexpectedly"),
      );
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.#worker.postMessage({ id, op, ...fields });
    });
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async #terminateWorker(): Promise<void> {
    this.#closed = true;
    this.#failAll(new Error("NodeSqliteExecutor is closed"));
    if (!this.#isWorkerDead()) {
      await this.#worker.terminate();
    }
  }
}
