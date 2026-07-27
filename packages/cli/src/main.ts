#!/usr/bin/env node
/**
 * `collector-cli` — thin client over the local service IPC (#172/#173).
 */

import { runCollectorCli } from "./run.js";

void runCollectorCli(process.argv.slice(2)).then((code) => {
  process.exit(code);
});
