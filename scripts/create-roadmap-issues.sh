#!/usr/bin/env bash
# Creates GitHub milestones and issues for Collector roadmap.
set -euo pipefail

REPO="pamnard/collector"

create_milestone() {
  local title="$1"
  local description="$2"
  gh api "repos/${REPO}/milestones" \
    -f title="$title" \
    -f description="$description" \
    -f state="open" \
    --jq '.number'
}

create_issue() {
  local title="$1"
  local body="$2"
  local milestone_title="$3"
  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body "$body" \
    --milestone "$milestone_title"
}

M0_TITLE="M0: Foundation"
M1_TITLE="M1: Shell & Users"
M2_TITLE="M2: Content Core"
M3_TITLE="M3: Capture & Portability"
M4_TITLE="M4: Sync Plugins"
M5_TITLE="M5: Polish & Release"

if ! gh api "repos/${REPO}/milestones" --jq '.[].title' | grep -q "M0: Foundation"; then
  create_milestone "$M0_TITLE" "Project structure, vault filesystem, SQLite schema, core ops, Tauri plugins + IPC."
  create_milestone "$M1_TITLE" "Local multi-user auth, app layout, routing, settings."
  create_milestone "$M2_TITLE" "ContentItem CRUD, tags, collections, search, grid/table UI, detail page."
  create_milestone "$M3_TITLE" "Import/export, drag-drop, URL capture, reindex."
  create_milestone "$M4_TITLE" "Plugin API, keychain, scheduler, Reddit/Telegram/Pinterest plugins."
  create_milestone "$M5_TITLE" "Media previews, CI builds, migration, encryption, auto-update."
else
  echo "Milestones already exist, skipping creation."
fi

echo "Creating M0 issues..."
create_issue "Monorepo layout (packages/core, packages/db)" \
  "Set up npm/pnpm workspaces:\n- \`packages/core\` — domain logic, import pipeline\n- \`packages/db\` — schema, migrations, queries\n- \`packages/shared\` — types, zod schemas\n- app shell stays in repo root\n\nAcceptance: \`npm run build\` builds all packages; imports resolve." "$M0_TITLE"

create_issue "Vault filesystem layout" \
  "Implement on-disk structure:\n\`\`\`\n{dataDir}/users/{userId}/vaults/{vaultId}/\n  vault.meta.json\n  items/{itemId}/\n    item.json\n    content.md (optional)\n    media/\n    .source.json (optional)\n\`\`\`\n\nAcceptance: helper API to create item folder + write/read item.json." "$M0_TITLE"

create_issue "SQLite schema and migrations" \
  "Tables: users, vaults, items, tags, item_tags, collections, item_collections, media, source_refs.\nFTS5 virtual table for search (can be M2 but schema here).\nUse Drizzle or versioned SQL migrations.\n\nAcceptance: migration runs on first launch; schema version tracked." "$M0_TITLE"

create_issue "Core vault operations" \
  "Implement in \`packages/core\`:\n- create/open vault\n- upsert item (file + index)\n- delete item\n- sync index from filesystem (full scan)\n\nAcceptance: integration test — write file, index updated; delete file, index cleaned." "$M0_TITLE"

create_issue "Tauri plugins (fs, sql) and IPC bridge" \
  "Add \`tauri-plugin-fs\`, \`tauri-plugin-sql\`.\nTyped IPC commands wrapping core ops (thin Rust, logic in TS).\nPreload + contextIsolation.\n\nAcceptance: renderer calls \`createItem\` via IPC; item appears on disk and in DB." "$M0_TITLE"

echo "Creating M1 issues..."
create_issue "Local users: model and password hashing" \
  "Users table: id, username, password_hash (argon2), created_at.\nSession: current user in app state + secure storage.\nNo JWT — local only.\n\nAcceptance: register user, login, password verify, logout." "$M1_TITLE"

create_issue "UI: login, register, switch user" \
  "Auth screens before main app.\nSwitch user from settings (lock vault, return to login).\n\nAcceptance: two users can coexist; switching shows correct vaults." "$M1_TITLE"

create_issue "App shell: Layout, Sidebar, Header" \
  "Port concepts from legacy collector UI:\n- collapsible sidebar\n- header with search placeholder, view toggle, add button\n- main scroll area\n\nTailwind + shadcn/ui optional.\n\nAcceptance: responsive layout, dark/light theme class support." "$M1_TITLE"

create_issue "Routing and URL-based filters" \
  "React Router: /, /item/:id, /settings.\nQuery params: ?filter=favorite|archived|tag:ID|collection:ID&q=search.\n\nAcceptance: filter change updates URL; deep link restores filter." "$M1_TITLE"

create_issue "Settings page" \
  "Theme toggle, data directory display, default vault selector, about/version.\n\nAcceptance: theme persists across restarts." "$M1_TITLE"

echo "Creating M2 issues..."
create_issue "ContentItem CRUD" \
  "All content types: article, video, image, note, bookmark, pdf, audio, other.\nFields match legacy model: title, description, content, url, content_type, source_type, metadata JSON, flags.\n\nAcceptance: create/edit/delete from UI; persisted to item.json + index." "$M2_TITLE"

create_issue "Tags" \
  "Per-vault tags with optional color hex.\nM2M with items.\nCRUD in UI (TagsManager pattern from legacy).\n\nAcceptance: assign/remove tags on item; filter by tag." "$M2_TITLE"

create_issue "Collections (tree)" \
  "Hierarchical collections via parent_id.\nM2M with items.\nSidebar list with counts.\n\nAcceptance: nested collections; item in multiple collections." "$M2_TITLE"

create_issue "Media files attach and storage" \
  "Copy files into \`items/{id}/media/\`.\nmedia table: path, media_type, item_id.\nSupport multiple files per item.\n\nAcceptance: upload image; shows in item detail + gallery." "$M2_TITLE"

create_issue "Thumbnail generation" \
  "Generate cover/thumbnail for images; first frame or poster for video (ffmpeg or native later).\nStore as \`media/cover.webp\`; reference in item index.\n\nAcceptance: grid shows thumbnails for image/video items." "$M2_TITLE"

create_issue "Favorite and archive flags" \
  "Toggle from grid and detail.\nSidebar filters: Favorites, Archive.\nArchived hidden from default \"All\" view.\n\nAcceptance: matches legacy filter behavior." "$M2_TITLE"

create_issue "FTS5 full-text search" \
  "Index title, description, content.\nDebounce search in header.\nHighlight or rank by relevance (basic).\n\nAcceptance: search finds partial matches across 1k items <100ms." "$M2_TITLE"

create_issue "Dashboard: masonry grid" \
  "react-masonry-css + TeaserCard.\nAnimatePresence for list changes.\nPagination or infinite scroll (30 per page).\n\nAcceptance: grid view matches legacy masonry spec." "$M2_TITLE"

create_issue "Dashboard: table view" \
  "ContentTable: title, type, tags, date, actions.\nToggle grid/table in header (persist preference).\n\nAcceptance: same data as grid; sortable columns optional v2." "$M2_TITLE"

create_issue "Content detail page" \
  "Full item view: metadata, markdown content, media gallery, tags/collections editor, set cover.\n\nAcceptance: navigate from card; edit inline or form." "$M2_TITLE"

create_issue "Sidebar navigation and filters" \
  "Sections: All, Favorites, Archive, Collections, Tags.\nCounts from index.\nActive state sync with URL.\n\nAcceptance: click filter → dashboard updates." "$M2_TITLE"

echo "Creating M3 issues..."
create_issue "Drag-and-drop import" \
  "Drop files onto app window → create ContentItem(s) with appropriate content_type.\nMulti-file → multiple items or one gallery item (decide in impl).\n\nAcceptance: drop PNG → image item with media attached." "$M3_TITLE"

create_issue "Manual create: note and bookmark" \
  "Modal/form: title, url (bookmark), content (note), tags, collection.\n\nAcceptance: create without external source." "$M3_TITLE"

create_issue "URL capture" \
  "Paste URL → fetch OpenGraph/metadata (tauri-plugin-http).\nOptional: save readability HTML snapshot to content.html.\n\nAcceptance: paste link → bookmark with title + description." "$M3_TITLE"

create_issue "Export vault as zip" \
  "Zip entire vault folder + manifest with schema version.\n\nAcceptance: export → import on another machine restores items." "$M3_TITLE"

create_issue "Import vault from zip" \
  "Validate manifest, extract, merge or new vault.\nConflict policy: skip or rename duplicates by id.\n\nAcceptance: round-trip with export issue." "$M3_TITLE"

create_issue "Reindex from filesystem" \
  "Admin action: scan all item.json, rebuild SQLite + FTS.\nReport orphans and errors.\n\nAcceptance: delete DB file → reindex restores full state from files." "$M3_TITLE"

echo "Creating M4 issues..."
create_issue "Sync plugin API contract" \
  "TypeScript interface:\n\`\`\`ts\ninterface SyncPlugin {\n  id: string;\n  authenticate(): Promise<void>;\n  pull(cursor?: string): Promise<PullResult>;\n}\n\`\`\`\nNormalizedItem → core import pipeline.\n\nAcceptance: documented in docs/PLUGINS.md; mock plugin works." "$M4_TITLE"

create_issue "Plugin registry and loader" \
  "Register plugins at build time or runtime config.\nPlugin settings UI: enable/disable, last sync, errors.\n\nAcceptance: enable mock plugin; manual sync creates items." "$M4_TITLE"

create_issue "Credential storage (OS keychain)" \
  "Store plugin tokens in OS keychain via Tauri plugin (stronghold/keyring).\nNever plain text in vault files.\n\nAcceptance: re-login not needed after app restart." "$M4_TITLE"

create_issue "Background sync scheduler" \
  "Configurable interval per plugin.\nManual \"Sync now\" button.\nQueue + status in UI; no silent failures.\n\nAcceptance: scheduled pull runs; errors logged and shown." "$M4_TITLE"

create_issue "Plugin: Reddit saved posts" \
  "Pull saved posts/links from Reddit API.\nMap to ContentItem + source_ref.\nIdempotent by reddit post id.\n\nAcceptance: auth + pull adds new saves only on re-sync." "$M4_TITLE"

create_issue "Plugin: Telegram" \
  "v1: import from Telegram Desktop export JSON.\nv2 (optional): user-session pull via TDLib.\nMap messages/media to items.\n\nAcceptance: import export file → items with media." "$M4_TITLE"

create_issue "Plugin: Pinterest" \
  "OAuth + pull saved pins/boards.\nDownload pin image where allowed.\n\nAcceptance: auth + sync creates image/bookmark items." "$M4_TITLE"

echo "Creating M5 issues..."
create_issue "Video and audio preview" \
  "Inline player in detail page.\nStream from local media path via asset protocol.\n\nAcceptance: play mp4/webm/audio without external app." "$M5_TITLE"

create_issue "PDF preview" \
  "pdf.js embedded viewer in detail page.\n\nAcceptance: open pdf media inline." "$M5_TITLE"

create_issue "Markdown and GFM rendering" \
  "react-markdown + remark-gfm for notes/articles.\nTailwind typography.\n\nAcceptance: render content.md with code blocks, tables, links." "$M5_TITLE"

create_issue "Migration from legacy Django collector" \
  "One-shot tool: Postgres dump or API export → vault zip.\nMap Vault, ContentItem, Tag, Collection, MediaFile.\nCopy media files.\n\nAcceptance: migrate sample DB; items match in new app." "$M5_TITLE"

create_issue "CI: cross-platform builds" \
  "GitHub Actions: build Linux, macOS, Windows on tag push.\nCache cargo + npm.\nUpload artifacts.\n\nAcceptance: release workflow produces three binaries." "$M5_TITLE"

create_issue "Tauri auto-updater" \
  "Configure updater + signing keys.\nCheck on startup (optional toggle).\n\nAcceptance: update channel documented; test with draft release." "$M5_TITLE"

create_issue "Vault encryption at rest" \
  "Optional master password → encrypt item content + media or SQLCipher.\nUnlock on login.\n\nAcceptance: encrypted vault unreadable without password; perf acceptable." "$M5_TITLE"

echo "Done. View: https://github.com/${REPO}/milestones"
