export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Log service failures so headless smoke (console.error hook) catches UI-only errors. */
export function reportServiceError(scope: string, err: unknown): void {
  console.error(`[collector] ${scope}:`, errorMessage(err));
}
