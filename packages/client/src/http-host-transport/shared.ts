import { hostWireError } from "@collector/service/wire";

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rpc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(
      hostWireError({
        layer: "transport",
        code: "cancelled",
        message: `${label} cancelled`,
      }),
    );
  }
  if (timeoutMs === undefined) {
    if (!signal) {
      return promise;
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(
          hostWireError({
            layer: "transport",
            code: "cancelled",
            message: `${label} cancelled`,
          }),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        hostWireError({
          layer: "transport",
          code: "timeout",
          message: `${label} timed out after ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        hostWireError({
          layer: "transport",
          code: "cancelled",
          message: `${label} cancelled`,
        }),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
