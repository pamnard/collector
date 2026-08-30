import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** Shared CLI argv for live host integration suites (#922). */
export function cliArgs(
  host: { baseUrl: string },
  dataDir: string,
  ...rest: string[]
): string[] {
  return ["--base-url", host.baseUrl, "--data-dir", dataDir, ...rest];
}

/** Temp dataDir registry cleaned in afterEach. */
export function useTempDataDirs(): {
  track: (dir: string) => string;
  mktemp: (prefix: string) => string;
} {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  return {
    track(dir: string): string {
      dirs.push(dir);
      return dir;
    },
    mktemp(prefix: string): string {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    },
  };
}
