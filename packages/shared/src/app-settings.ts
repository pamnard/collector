import { z } from "zod";

export const APP_SETTINGS_VERSION = 1;

export const appSettingsSchema = z.object({
  schema_version: z.number().int().default(APP_SETTINGS_VERSION),
  theme: z.enum(["light", "dark"]).default("light"),
  active_vault_id: z.string().uuid().nullable().optional(),
  view_mode: z.enum(["grid", "table"]).default("grid"),
  nav_filter: z.enum(["all", "favorite", "archived"]).default("all"),
  nav_search: z.string().default(""),
  check_updates_on_start: z.boolean().default(false),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = appSettingsSchema.parse({});

export const APP_SETTINGS_FILE = "settings.json";
