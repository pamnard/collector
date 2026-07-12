export const MIGRATION_004 = `-- Collector schema v4
-- Repair legacy/partial items tables: 001 uses CREATE IF NOT EXISTS and never backfills missing columns.

ALTER TABLE items ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN url TEXT;
ALTER TABLE items ADD COLUMN content_type TEXT NOT NULL DEFAULT 'note';
ALTER TABLE items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE items ADD COLUMN source_id TEXT;
ALTER TABLE items ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE items ADD COLUMN thumbnail_path TEXT;
ALTER TABLE items ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN has_content_file INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN folder_path TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

UPDATE items SET created_at = datetime('now') WHERE created_at = '';
UPDATE items SET updated_at = datetime('now') WHERE updated_at = '';

CREATE INDEX IF NOT EXISTS idx_items_vault_created ON items(vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_content_type ON items(content_type);
CREATE INDEX IF NOT EXISTS idx_items_flags ON items(is_archived, is_favorite);
CREATE INDEX IF NOT EXISTS idx_items_sort_order ON items(vault_id, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_folder_path ON items(vault_id, folder_path);
`;
