/** Log service failures so headless smoke (console.error hook) catches UI-only errors. */
export function reportServiceError(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[collector] ${scope}:`, message);
}
