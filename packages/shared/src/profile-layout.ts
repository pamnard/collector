/**
 * Canonical Collector on-disk profile layout (#238 / epic #142).
 *
 * Matches the production Tauri app (see README “Data locations”):
 *
 * - **dataDir** — vault files parent (`…/collector/`), contains `vaults/`
 * - **configDir** — UI preferences (`…/collector/`), contains `settings.json`
 * - **indexDbPath** — disposable SQLite index: sibling of `configDir` named `collector.db`
 *
 * Production (split roots):
 *   dataDir   = `{appDataDir}/collector`
 *   configDir = `{appConfigDir}/collector`
 *   indexDb   = `{appConfigDir}/collector.db`
 *
 * Self-contained profile (smokes / isolated `--data-dir` only):
 *   configDir = `{dataDir}/config`
 *   indexDb   = `{dataDir}/collector.db`
 */

export const COLLECTOR_INDEX_DB_FILE = "collector.db";
export const COLLECTOR_SELF_CONTAINED_CONFIG_DIR = "config";

export interface CollectorProfileLayout {
  /** Parent of `vaults/` (and service lock/logs for this profile). */
  dataDir: string;
  /** Directory that holds `settings.json` (and dashboard snapshot). */
  configDir: string;
  /** Absolute path to `collector.db`. */
  indexDbPath: string;
}

function trimTrailingSlashes(path: string): string {
  if (path.length > 1 && (path.endsWith("/") || path.endsWith("\\"))) {
    return path.replace(/[/\\]+$/, "");
  }
  return path;
}

/** Parent directory of a path (POSIX + Windows drive prefixes). */
export function parentDir(path: string): string {
  const normalized = trimTrailingSlashes(path).replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  if (normalized.charAt(idx - 1) === ":") {
    return normalized.slice(0, idx + 1);
  }
  return normalized.slice(0, idx);
}

function joinPath(base: string, child: string): string {
  const left = trimTrailingSlashes(base).replace(/\\/g, "/");
  const right = child.replace(/\\/g, "/").replace(/^\/+/, "");
  if (left.endsWith(":")) {
    return `${left}/${right}`;
  }
  return `${left}/${right}`;
}

/**
 * Index DB path for a config directory: `{parent(configDir)}/collector.db`.
 * Production: configDir=`…/com.collector.app/collector` → `…/com.collector.app/collector.db`.
 * Self-contained: configDir=`{dataDir}/config` → `{dataDir}/collector.db`.
 */
export function indexDbPathForConfigDir(configDir: string): string {
  return joinPath(parentDir(configDir), COLLECTOR_INDEX_DB_FILE);
}

/** Build layout from explicit vault + settings roots. */
export function resolveCollectorProfileLayout(input: {
  dataDir: string;
  configDir: string;
}): CollectorProfileLayout {
  const dataDir = trimTrailingSlashes(input.dataDir);
  const configDir = trimTrailingSlashes(input.configDir);
  if (!dataDir) {
    throw new Error("Collector profile layout requires a non-empty dataDir");
  }
  if (!configDir) {
    throw new Error("Collector profile layout requires a non-empty configDir");
  }
  return {
    dataDir,
    configDir,
    indexDbPath: indexDbPathForConfigDir(configDir),
  };
}

/**
 * Self-contained profile under a single `--data-dir` (host smokes).
 * Equivalent to `configDir = {dataDir}/config`.
 */
export function selfContainedCollectorProfileLayout(
  dataDir: string,
): CollectorProfileLayout {
  const root = trimTrailingSlashes(dataDir);
  if (!root) {
    throw new Error("self-contained profile requires a non-empty dataDir");
  }
  return resolveCollectorProfileLayout({
    dataDir: root,
    configDir: joinPath(root, COLLECTOR_SELF_CONTAINED_CONFIG_DIR),
  });
}
