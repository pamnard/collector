/**
 * Silent Markdown autofix via markdownlint + applyFixes (Collector note lint).
 * Node-oriented — import from `@collector/core/node`, not the UI barrel.
 */

import { applyFixes } from "markdownlint";
import { lint as lintSync } from "markdownlint/sync";
import type { Configuration } from "markdownlint";

/** Fixed v1 allowlist — do not expand without a product decision. */
const MARKDOWN_NORMALIZE_CONFIG: Configuration = {
  default: false,
  MD009: true,
  MD010: true,
  MD012: true,
  MD018: true,
  MD019: true,
  MD022: true,
  MD023: true,
  MD027: true,
  MD030: true,
  MD031: true,
  MD032: true,
  MD037: true,
  MD038: true,
  MD039: true,
  MD047: true,
  MD004: { style: "dash" },
  MD048: { style: "backtick" },
  MD049: { style: "asterisk" },
  MD050: { style: "asterisk" },
};

const MAX_FIX_PASSES = 10;

export type NormalizeMarkdownResult = {
  text: string;
  changed: boolean;
};

/**
 * Apply markdownlint allowlist fixes until stable.
 * Idempotent: clean input → `{ changed: false }`.
 */
export function normalizeMarkdown(raw: string): NormalizeMarkdownResult {
  let text = raw;
  for (let pass = 0; pass < MAX_FIX_PASSES; pass++) {
    const results = lintSync({
      strings: { content: text },
      config: MARKDOWN_NORMALIZE_CONFIG,
    });
    const errors = results.content;
    if (errors === undefined) {
      throw new Error(
        "normalizeMarkdown: markdownlint results missing `content` for input string key",
      );
    }
    const next = applyFixes(text, errors);
    if (next === text) {
      break;
    }
    text = next;
  }
  return { text, changed: text !== raw };
}
