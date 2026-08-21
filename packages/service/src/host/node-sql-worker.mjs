/**
 * better-sqlite3 owner for NodeSqliteExecutor (#749).
 * Plain ESM so worker_threads can load it without a TypeScript loader.
 * Runs only inside a Worker — never on the host UI event loop.
 */

import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("node-sql-worker must run as a worker_threads Worker");
}

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const port = parentPort;
/** @type {import("better-sqlite3").Database | null} */
let db = null;

port.on("message", (msg) => {
  try {
    switch (msg.op) {
      case "open": {
        if (db) {
          throw new Error("SQLite worker database is already open");
        }
        db = new Database(msg.path);
        db.pragma("foreign_keys = ON");
        port.postMessage({ id: msg.id, ok: true });
        break;
      }
      case "execute": {
        if (!db) {
          throw new Error("SQLite worker database is not open");
        }
        const result = db.prepare(msg.query).run(...msg.bind);
        port.postMessage({ id: msg.id, ok: true, result: result.changes });
        break;
      }
      case "select": {
        if (!db) {
          throw new Error("SQLite worker database is not open");
        }
        const rows = db.prepare(msg.query).all(...msg.bind);
        port.postMessage({ id: msg.id, ok: true, result: rows });
        break;
      }
      case "close": {
        if (db) {
          db.close();
          db = null;
        }
        port.postMessage({ id: msg.id, ok: true });
        break;
      }
      default:
        throw new Error(`Unknown SQLite worker op: ${String(msg.op)}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    port.postMessage({ id: msg.id, ok: false, error });
  }
});
