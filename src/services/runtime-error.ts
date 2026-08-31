export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Host/service missing-item errors use this prefix (path-as-id after the colon). */
export function isItemNotFoundMessage(message: string): boolean {
  return message.startsWith("Item not found:");
}

/** Log service failures so headless smoke (console.error hook) catches UI-only errors. */
export function reportServiceError(scope: string, err: unknown): void {
  console.error(`[collector] ${scope}:`, errorMessage(err));
}
