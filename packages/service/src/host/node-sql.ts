/**
 * Node host SQLite adapter (#151 / #749).
 *
 * Isolation note: a Promise-returning SqlExecutor is not non-blocking by itself.
 * better-sqlite3 prepare/run/all are synchronous. This class isolates them in a
 * dedicated worker_threads Worker so the host UI/RPC event loop stays responsive.
 * One worker (and one native DB connection) per opened DB file.
 */

import { Worker } from "node:worker_threads";
import type { ClosableSqlExecutor } from "../index-boot.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerResponse =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string };

function workerScriptUrl(): URL {
  // Sibling .mjs loads under vitest (src/) and after build (dist/) alike.
  return new URL("./node-sql-worker.mjs", import.meta.url);
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
        return;
      }
      this.#pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.result);
        return;
      }
      pending.reject(new Error(msg.error));
    });
    worker.on("error", (err) => {
      this.#failAll(err instanceof Error ? err : new Error(String(err)));
    });
    worker.on("exit", (code) => {
      if (!this.#closed) {
        this.#failAll(new Error(`SQLite worker exited unexpectedly (code ${code})`));
      }
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
      await executor.#terminateWorker();
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<number> {
    const changes = await this.#request("execute", {
      query,
      bind: bindValues,
    });
    return changes as number;
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T[]> {
    const rows = await this.#request("select", {
      query,
      bind: bindValues,
    });
    return rows as T[];
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      await this.#request("close", {});
    } finally {
      await this.#worker.terminate();
      this.#failAll(new Error("NodeSqliteExecutor is closed"));
    }
  }

  #request(
    op: "open" | "execute" | "select" | "close",
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.#closed && op !== "close") {
      return Promise.reject(new Error("NodeSqliteExecutor is closed"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
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
    await this.#worker.terminate();
  }
}
