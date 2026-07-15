import { z } from "zod";
import { navFilterSettingSchema } from "./folders.js";
import { itemFileSchema } from "./schemas.js";

export const DASHBOARD_SNAPSHOT_VERSION = 1;
export const DASHBOARD_SNAPSHOT_FILE = "dashboard-snapshot.json";

export const dashboardSnapshotSchema = z.object({
  schema_version: z.number().int().default(DASHBOARD_SNAPSHOT_VERSION),
  vault_id: z.string().uuid(),
  nav_filter: navFilterSettingSchema,
  search: z.string().default(""),
  item_ids: z.array(z.string().uuid()),
  items: z.array(itemFileSchema),
  total_count: z.number().int().nonnegative(),
  stream_end_offset: z.number().int().nonnegative(),
  saved_at: z.string().datetime(),
});

export type DashboardSnapshot = z.infer<typeof dashboardSnapshotSchema>;

export function navFilterSettingKey(
  filter: z.infer<typeof navFilterSettingSchema>,
): string {
  if (typeof filter === "string") {
    return filter;
  }
  if (filter.type === "tag") {
    return `tag:${filter.tag_id}`;
  }
  return `folder:${filter.folder_path}`;
}

export function dashboardSnapshotMatchesQuery(
  snapshot: DashboardSnapshot,
  query: {
    vaultId: string;
    navFilter: z.infer<typeof navFilterSettingSchema>;
    search: string;
  },
): boolean {
  return (
    snapshot.vault_id === query.vaultId &&
    navFilterSettingKey(snapshot.nav_filter) ===
      navFilterSettingKey(query.navFilter) &&
    snapshot.search === query.search
  );
}
