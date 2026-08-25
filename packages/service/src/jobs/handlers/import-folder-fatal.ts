export type ImportFolderFatalCode =
  | "active_vault_mismatch"
  | "no_active_vault"
  | "sqlite_error"
  | "index_unavailable"
  | "invalid_source"
  | "infrastructure";

/** Typed fatal signal for folder import — preferred over message heuristics. */
export class ImportFolderFatalError extends Error {
  readonly code: ImportFolderFatalCode;

  constructor(code: ImportFolderFatalCode, message: string) {
    super(message);
    this.name = "ImportFolderFatalError";
    this.code = code;
  }
}

export function importFolderErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inferFatalCodeFromMessage(
  message: string,
): ImportFolderFatalCode | null {
  if (/active vault mismatch/i.test(message)) {
    return "active_vault_mismatch";
  }
  if (/no active vault/i.test(message)) {
    return "no_active_vault";
  }
  if (/SQLITE_/i.test(message)) {
    return "sqlite_error";
  }
  if (/database is (closed|locked|not open)/i.test(message)) {
    return "sqlite_error";
  }
  if (/index (is )?(closed|unavailable|not (ready|open))/i.test(message)) {
    return "index_unavailable";
  }
  return null;
}

/**
 * Vault/index infrastructure failures must abort the job; per-file import
 * validation/content errors may continue after structured logging.
 * Prefer {@link ImportFolderFatalError}; message heuristics remain for
 * errors thrown by lower layers that lack a typed code.
 */
export function isFatalImportFolderError(error: unknown): boolean {
  if (error instanceof ImportFolderFatalError) {
    return true;
  }
  return inferFatalCodeFromMessage(importFolderErrorMessage(error)) !== null;
}
