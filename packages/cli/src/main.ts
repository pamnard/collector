#!/usr/bin/env node
/**
 * `collector` CLI — thin read-only client over the local service IPC (#172).
 */

import { runCollectorCli } from "./run.js";

const code = await runCollectorCli(process.argv.slice(2));
process.exit(code);
