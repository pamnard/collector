export const MIGRATION_002 = `-- Collector schema v2
-- Example incremental migration: manual sort order for dashboard reordering.

ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_items_sort_order ON items(vault_id, sort_order, created_at DESC);
`;
