/**
 * Download remote bytes for display-asset localization (#739).
 * Fail hard — no silent empty body / keep-remote.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchRemoteBytes(
  url: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `fetchRemoteBytes: ${url} returned ${response.status} ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new Error(`fetchRemoteBytes: empty body from ${url}`);
    }
    return new Uint8Array(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("fetchRemoteBytes failed", { url, error: message });
    throw error instanceof Error
      ? error
      : new Error(`fetchRemoteBytes: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
