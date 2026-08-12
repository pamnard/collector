import { z } from "zod";
import { navFilterSettingSchema } from "./folders.js";
import { itemFileSchema } from "./schemas.js";

export const DASHBOARD_SNAPSHOT_VERSION = 3;
export const DASHBOARD_SNAPSHOT_FILE = "dashboard-snapshot.json";

export const dashboardCoverPathEntrySchema = z.object({
  path: z.string().nullable(),
  stamp: z.string(),
});

export const dashboardSnapshotSchema = z.object({
  schema_version: z.number().int().default(DASHBOARD_SNAPSHOT_VERSION),
  vault_id: z.string().uuid(),
  nav_filter: navFilterSettingSchema,
  search: z.string().default(""),
  sort_key: z.string().default("created_at"),
  sort_dir: z.enum(["asc", "desc"]).default("desc"),
  item_ids: z.array(z.string().min(1)),
  items: z.array(itemFileSchema),
  /** Parallel presentation stamps for item_ids / items (#623). Missing = dirty. */
  body_stamps: z.record(z.string(), z.string()).default({}),
  total_count: z.number().int().nonnegative(),
  stream_end_offset: z.number().int().nonnegative(),
  cover_paths: z
    .record(z.string(), dashboardCoverPathEntrySchema)
    .default({}),
  saved_at: z.string().datetime(),
});

export type DashboardCoverPathEntry = z.infer<
  typeof dashboardCoverPathEntrySchema
>;
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
    sortKey?: string;
    sortDir?: "asc" | "desc";
  },
): boolean {
  const sortKey = query.sortKey ?? "created_at";
  const sortDir = query.sortDir ?? "desc";
  return (
    snapshot.vault_id === query.vaultId &&
    navFilterSettingKey(snapshot.nav_filter) ===
      navFilterSettingKey(query.navFilter) &&
    snapshot.search === query.search &&
    snapshot.sort_key === sortKey &&
    snapshot.sort_dir === sortDir
  );
}
