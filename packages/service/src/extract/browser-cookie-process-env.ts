/**
 * Process env for yt-dlp `--cookies-from-browser`.
 *
 * On Linux, Chrome encrypts cookies with a key from the session keyring.
 * secretstorage (used by yt-dlp) skips D-Bus unlock when XDG_CURRENT_DESKTOP
 * is unset — common for systemd --user services even when
 * DBUS_SESSION_BUS_ADDRESS is present. Without unlock, only a few public
 * cookies dump and Reddit/YouTube extract fails as cookies_unavailable.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Copy of `base` with a desktop hint when needed for keyring unlock.
 * Does not mutate `base`.
 */
export function processEnvForBrowserCookieAccess(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (process.platform !== "linux") {
    return env;
  }
  if (env.XDG_CURRENT_DESKTOP?.trim()) {
    return env;
  }
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  if (!runtimeDir) {
    return env;
  }
  if (!existsSync(join(runtimeDir, "keyring"))) {
    return env;
  }
  // Freedesktop Secret Service unlock path used by GNOME / several desktops.
  // Plain "KDE" is not enough for yt-dlp's Chrome cookie decrypt on this stack.
  env.XDG_CURRENT_DESKTOP = "GNOME";
  return env;
}
