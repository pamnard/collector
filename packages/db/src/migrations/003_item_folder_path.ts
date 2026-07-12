export const MIGRATION_003 = `-- Collector schema v3
-- Folder path on items for Obsidian-style organization.

ALTER TABLE items ADD COLUMN folder_path TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_items_folder_path ON items(vault_id, folder_path);
`;
