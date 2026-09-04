/**
 * Host data-dir store for itemExtractAuto one-shot markers.
 * Path: `{dataDir}/extract-auto/{vaultId}.json`.
 */

import type { FileSystemAdapter } from "@collector/core";
import {
  parseExtractAutoMap,
  type ExtractAutoAttempt,
  type ExtractAutoMap,
} from "./extract-auto-metadata.js";

const EXTRACT_AUTO_STATE_DIR = "extract-auto";

type VaultExtractAutoStateFile = {
  schema_version: 1;
  items: Record<string, unknown>;
};

export type ExtractAutoAttemptStore = {
  readItemAttempts(vaultId: string, itemId: string): Promise<ExtractAutoMap>;
  recordAttempt(
    vaultId: string,
    itemId: string,
    shortcode: string,
    attempt: ExtractAutoAttempt,
  ): Promise<void>;
};

export function createExtractAutoAttemptStore(deps: {
  fs: FileSystemAdapter;
  dataDir: string;
}): ExtractAutoAttemptStore {
  const statePathFor = (vaultId: string): string =>
    deps.fs.join(deps.dataDir, EXTRACT_AUTO_STATE_DIR, `${vaultId}.json`);

  const loadState = async (vaultId: string): Promise<VaultExtractAutoStateFile> => {
    const path = statePathFor(vaultId);
    if (!(await deps.fs.exists(path))) {
      return { schema_version: 1, items: {} };
    }
    const raw = JSON.parse(await deps.fs.readText(path)) as {
      schema_version?: unknown;
      items?: unknown;
    };
    if (
      raw.schema_version !== 1 ||
      typeof raw.items !== "object" ||
      !raw.items ||
      Array.isArray(raw.items)
    ) {
      throw new Error(
        `extract-auto state corrupt at ${path}: expected schema_version 1 with items`,
      );
    }
    return {
      schema_version: 1,
      items: raw.items as Record<string, unknown>,
    };
  };

  const saveState = async (
    vaultId: string,
    state: VaultExtractAutoStateFile,
  ): Promise<void> => {
    const dir = deps.fs.join(deps.dataDir, EXTRACT_AUTO_STATE_DIR);
    await deps.fs.mkdir(dir);
    await deps.fs.writeText(
      statePathFor(vaultId),
      `${JSON.stringify(state, null, 2)}\n`,
    );
  };

  return {
    async readItemAttempts(vaultId, itemId) {
      const state = await loadState(vaultId);
      return parseExtractAutoMap(state.items[itemId]);
    },

    async recordAttempt(vaultId, itemId, shortcode, attempt) {
      const state = await loadState(vaultId);
      const prev = parseExtractAutoMap(state.items[itemId]);
      state.items[itemId] = { ...prev, [shortcode]: attempt };
      await saveState(vaultId, state);
    },
  };
}
