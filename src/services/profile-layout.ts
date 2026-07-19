import { appConfigDir, appDataDir, join } from "@tauri-apps/api/path";
import {
  resolveCollectorProfileLayout,
  type CollectorProfileLayout,
} from "@collector/shared";

/**
 * Canonical on-disk roots for the running Tauri profile (#238).
 * Same layout the service host must use at cutover (#170).
 */
export async function getCollectorProfileLayout(): Promise<CollectorProfileLayout> {
  const dataDir = await join(await appDataDir(), "collector");
  const configDir = await join(await appConfigDir(), "collector");
  return resolveCollectorProfileLayout({ dataDir, configDir });
}
