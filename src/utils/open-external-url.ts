export type OpenUrlFn = (url: string) => Promise<void>;

export function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * Intercept http(s) anchor clicks so Tauri WebView does not navigate
 * (target=_blank / in-webview nav can freeze the UI on Linux WebKitGTK).
 * Returns true when the click was handled externally.
 */
export function handleExternalLinkClick(
  event: { preventDefault(): void },
  href: string | null | undefined,
  openUrlFn: OpenUrlFn,
): boolean {
  if (!href || !isExternalHttpUrl(href)) {
    return false;
  }

  event.preventDefault();
  void openUrlFn(href).then(undefined, (error: unknown) => {
    console.error("[openExternalUrl] failed", { href, error });
    throw error instanceof Error ? error : new Error(String(error));
  });
  return true;
}
