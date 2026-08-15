import { hostWireError } from "@collector/service/wire";
import { withTimeout } from "./shared.js";

export async function dialHttpHealth(
  baseUrl: string,
  token: string,
  connectTimeoutMs: number,
): Promise<void> {
  const run = (async () => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      throw hostWireError({
        layer: "transport",
        code: "not_connected",
        message:
          error instanceof Error
            ? `HTTP health dial failed: ${error.message}`
            : "HTTP health dial failed",
      });
    }
    if (response.status === 401) {
      throw hostWireError({
        layer: "auth",
        code: "auth_failed",
        message: "Bearer authentication failed",
      });
    }
    if (!response.ok && response.status !== 503) {
      throw hostWireError({
        layer: "transport",
        code: "not_connected",
        message: `HTTP health dial failed: HTTP ${response.status}`,
      });
    }
    await response.arrayBuffer();
  })();
  await withTimeout(run, connectTimeoutMs, "HTTP health dial");
}
