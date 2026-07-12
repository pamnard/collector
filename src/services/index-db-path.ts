import { appConfigDir, appDataDir, join } from "@tauri-apps/api/path";

/** Matches tauri-plugin-sql: `Database.load("sqlite:collector.db")` → appConfigDir. */
export const INDEX_DB_URI = "sqlite:collector.db";

export async function getIndexDatabasePath(): Promise<string> {
  return join(await appConfigDir(), "collector.db");
}

/** Wrong paths from earlier builds — delete so they cannot shadow the real index. */
export async function getLegacyIndexDatabasePaths(): Promise<string[]> {
  return [
    await join(await appDataDir(), "collector.db"),
    await join(await appDataDir(), "collector", "collector.db"),
  ];
}

export async function listIndexDatabasePaths(): Promise<string[]> {
  return [await getIndexDatabasePath(), ...(await getLegacyIndexDatabasePaths())];
}
