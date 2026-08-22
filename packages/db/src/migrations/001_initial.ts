export const MIGRATION_001 = `-- Collector schema v1
-- Files on disk are source of truth; SQLite is the search/filter index.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reconcile_fingerprint_json TEXT
);

-- id = vault-relative markdown path (e.g. "Inbox/note.md"), not a UUID (#134).
-- folder_path is derived from id (dirname) and kept as a column purely for
-- fast prefix queries; it is not an independent source of truth.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT,
  content_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  properties_json TEXT NOT NULL DEFAULT '{}',
  thumbnail_path TEXT,
  has_content_file INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  folder_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  file_mtime_ms INTEGER,
  content_revision INTEGER NOT NULL DEFAULT 1,
  word_count INTEGER NOT NULL,
  character_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_vault_created ON items(vault_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_content_type ON items(content_type);
CREATE INDEX IF NOT EXISTS idx_items_sort_order ON items(vault_id, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_folder_path ON items(vault_id, folder_path);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(vault_id, name)
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_collections (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, collection_id)
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_refs (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  synced_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(plugin_id, external_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED,
  title,
  description,
  content,
  tokenize = 'unicode61'
);

-- Semantic vectors for related/similar (#413). Disposable with the index.
CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  content_revision INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_embeddings_model
  ON item_embeddings(model_id);

-- Item↔item edges: text links + user edges (#407). Disposable with the index.
CREATE TABLE IF NOT EXISTS item_edges (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  raw_target TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('text', 'user')),
  kind TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  resolve_status TEXT CHECK (
    resolve_status IN ('resolved', 'unresolved', 'ambiguous')
    OR resolve_status IS NULL
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_item_edges_to_text
  ON item_edges(to_id, source)
  WHERE to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_edges_from_text
  ON item_edges(from_id, source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_edges_text_dedup
  ON item_edges(from_id, source, kind, raw_target, position)
  WHERE source = 'text';
CREATE UNIQUE INDEX IF NOT EXISTS idx_item_edges_user_pair
  ON item_edges(vault_id, from_id, to_id)
  WHERE source = 'user';

-- Marker: FTS content is full on-disk markdown (#534). Absent → recreate index.
CREATE TABLE IF NOT EXISTS index_build (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);
INSERT OR IGNORE INTO index_build (id) VALUES (1);
`;
