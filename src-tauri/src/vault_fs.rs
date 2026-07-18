use filetime::{set_file_mtime, FileTime};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Sidecar dir next to `note.md` → `note.media/`. Mirrors
/// `packages/shared/src/constants.ts` `ITEM_MEDIA_SUFFIX`.
const ITEM_MEDIA_SUFFIX: &str = ".media";
const MEDIA_MANIFEST_FILE: &str = "manifest.json";

/// Top-level names that are never markdown items / real folders. Mirrors
/// `packages/shared/src/constants.ts` `RESERVED_VAULT_ENTRIES`.
const RESERVED_VAULT_ENTRIES: &[&str] = &[
    "vault.meta.json",
    "tags.json",
    "folders.json",
    "items",
    ".collector-touch",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemStatMeta {
    pub id: String,
    pub mtime_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemMetaRead {
    pub id: String,
    pub document_markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveItem {
    pub id: String,
    pub thumbnail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailResolveResult {
    pub id: String,
    pub path: Option<String>,
}

#[derive(Deserialize)]
struct MediaManifest {
    #[serde(default)]
    files: Vec<MediaFileEntry>,
}

#[derive(Deserialize)]
struct MediaFileEntry {
    id: String,
    filename: String,
    media_type: String,
    created_at: String,
}

fn is_reserved_entry(name: &str) -> bool {
    RESERVED_VAULT_ENTRIES.contains(&name) || name.ends_with(ITEM_MEDIA_SUFFIX)
}

fn is_markdown_item_file(name: &str) -> bool {
    name.to_lowercase().ends_with(".md") && !name.starts_with('.')
}

fn join_relative(base: &str, name: &str) -> String {
    if base.is_empty() {
        name.to_string()
    } else {
        format!("{base}/{name}")
    }
}

/// Recursively collect vault-relative `.md` item paths, mirroring the
/// TS `walkVault` traversal in `packages/core/src/vault/scan.ts`.
fn walk_items(root: &Path, rel_dir: &str, items: &mut Vec<String>) -> Result<(), String> {
    let abs_dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };

    let entries = fs::read_dir(&abs_dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || is_reserved_entry(&name) {
            continue;
        }

        let rel = join_relative(rel_dir, &name);
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            walk_items(root, &rel, items)?;
            continue;
        }

        if is_markdown_item_file(&name) {
            items.push(rel);
        }
    }

    Ok(())
}

fn dirname(relative_path: &str) -> String {
    match relative_path.rfind('/') {
        Some(index) => relative_path[..index].to_string(),
        None => String::new(),
    }
}

fn basename(relative_path: &str) -> &str {
    match relative_path.rfind('/') {
        Some(index) => &relative_path[index + 1..],
        None => relative_path,
    }
}

/// `note.md` → `note.media` (directory name). Mirrors `itemMediaDirName`.
fn item_media_dir_name(item_id: &str) -> Result<String, String> {
    let base = basename(item_id);
    if base.len() < 3 || !base.to_lowercase().ends_with(".md") {
        return Err(format!("Item path must end with .md: {item_id}"));
    }
    let stem = &base[..base.len() - 3];
    Ok(format!("{stem}{ITEM_MEDIA_SUFFIX}"))
}

/// Absolute media root for an item (`…/note.media`). Mirrors `itemMediaRoot`.
fn item_media_root(vault_path: &str, item_id: &str) -> Result<PathBuf, String> {
    let dir = dirname(item_id);
    let media_name = item_media_dir_name(item_id)?;
    let mut path = PathBuf::from(vault_path);
    if !dir.is_empty() {
        for segment in dir.split('/') {
            path.push(segment);
        }
    }
    path.push(media_name);
    Ok(path)
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

#[tauri::command]
pub fn vault_items_stat_meta(vault_path: String) -> Result<Vec<VaultItemStatMeta>, String> {
    let root = Path::new(&vault_path);
    if !root.is_dir() {
        return Ok(vec![]);
    }

    let mut ids = Vec::new();
    walk_items(root, "", &mut ids)?;

    let mut results = Vec::with_capacity(ids.len());
    for id in ids {
        let mtime_ms = mtime_ms(&root.join(&id));
        results.push(VaultItemStatMeta { id, mtime_ms });
    }
    Ok(results)
}

#[tauri::command]
pub fn vault_items_read_meta(
    vault_path: String,
    ids: Vec<String>,
) -> Result<Vec<VaultItemMetaRead>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let root = Path::new(&vault_path);
    let mut results = Vec::with_capacity(ids.len());

    for id in ids {
        let doc_path = root.join(&id);
        if !doc_path.is_file() {
            continue;
        }

        let document_markdown =
            fs::read_to_string(&doc_path).map_err(|error| format!("{id}: {error}"))?;
        results.push(VaultItemMetaRead {
            id,
            document_markdown,
        });
    }

    Ok(results)
}

fn resolve_thumbnail_absolute(vault_path: &str, item_id: &str, thumbnail: &str) -> PathBuf {
    let normalized = thumbnail.replace('\\', "/");
    if normalized.starts_with('/') {
        return PathBuf::from(normalized);
    }

    if normalized
        .chars()
        .nth(1)
        .is_some_and(|character| character == ':')
    {
        return PathBuf::from(normalized);
    }

    let dir = dirname(item_id);
    let mut resolved = PathBuf::from(vault_path);
    if !dir.is_empty() {
        for segment in dir.split('/') {
            resolved.push(segment);
        }
    }
    for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
        resolved.push(segment);
    }
    resolved
}

fn sanitize_media_filename(filename: &str) -> String {
    let base = filename
        .split(&['/', '\\'][..])
        .next_back()
        .unwrap_or("file");
    let cleaned: String = base
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || ".-_".contains(character) {
                character
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned
    }
}

fn media_file_path(media_root: &Path, media_id: &str, filename: &str) -> PathBuf {
    let stored = format!("{}-{}", media_id, sanitize_media_filename(filename));
    media_root.join(stored)
}

fn first_image_media_path(media_root: &Path) -> Option<PathBuf> {
    let manifest_path = media_root.join(MEDIA_MANIFEST_FILE);
    if !manifest_path.is_file() {
        return None;
    }

    let raw = fs::read_to_string(&manifest_path).ok()?;
    let manifest: MediaManifest = serde_json::from_str(&raw).ok()?;
    let mut files = manifest.files;
    files.sort_by(|left, right| left.created_at.cmp(&right.created_at));

    for file in files {
        if file.media_type != "image" {
            continue;
        }

        let candidate = media_file_path(media_root, &file.id, &file.filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn resolve_one_thumbnail(vault_path: &str, item: &ThumbnailResolveItem) -> ThumbnailResolveResult {
    if let Some(thumbnail) = item.thumbnail.as_deref().filter(|value| !value.is_empty()) {
        let candidate = resolve_thumbnail_absolute(vault_path, &item.id, thumbnail);
        if candidate.is_file() {
            return ThumbnailResolveResult {
                id: item.id.clone(),
                path: Some(candidate.to_string_lossy().into_owned()),
            };
        }
    }

    let path = match item_media_root(vault_path, &item.id) {
        Ok(media_root) => {
            first_image_media_path(&media_root).map(|candidate| candidate.to_string_lossy().into_owned())
        }
        Err(_) => None,
    };
    ThumbnailResolveResult {
        id: item.id.clone(),
        path,
    }
}

#[tauri::command]
pub fn resolve_item_thumbnail_paths(
    vault_path: String,
    items: Vec<ThumbnailResolveItem>,
) -> Result<Vec<ThumbnailResolveResult>, String> {
    if items.is_empty() {
        return Ok(vec![]);
    }

    Ok(items
        .iter()
        .map(|item| resolve_one_thumbnail(&vault_path, item))
        .collect())
}

/// Bump atime/mtime of an existing path (file or directory). Used by reconcile
/// fingerprint invalidation — must match Node `utimes`, not a stamp file.
#[tauri::command]
pub fn fs_touch(path: String) -> Result<(), String> {
    touch_path(&path)
}

/// Create a new text file exclusively (`O_EXCL` / `create_new`). Fails with an
/// `EEXIST`-tagged message if the path already exists — used for vault bootstrap lock.
#[tauri::command]
pub fn fs_write_text_exclusive(path: String, content: String) -> Result<(), String> {
    write_text_exclusive(&path, &content)
}

fn write_text_exclusive(path: &str, content: &str) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!("EEXIST: file already exists: {path}")
            } else {
                format!("failed to create exclusive file {path}: {error}")
            }
        })?;
    file
        .write_all(content.as_bytes())
        .map_err(|error| format!("failed to write exclusive file {path}: {error}"))?;
    Ok(())
}

fn touch_path(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    set_file_mtime(target, FileTime::now()).map_err(|error| {
        format!("failed to touch {path}: {error}")
    })
}

#[cfg(test)]
mod tests {
    use super::{item_media_dir_name, touch_path, walk_items, write_text_exclusive};
    use std::fs;
    use std::path::Path;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn write_text_exclusive_creates_once() {
        let dir = tempfile_dir("wx");
        let path = dir.join("lock");
        let path_str = path.to_string_lossy().into_owned();
        write_text_exclusive(&path_str, "one").unwrap();
        let err = write_text_exclusive(&path_str, "two").unwrap_err();
        assert!(err.contains("EEXIST"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "one");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn touch_path_updates_directory_mtime() {
        let dir = tempfile_dir("touch");
        let dir_str = dir.to_string_lossy().into_owned();
        let before = fs::metadata(&dir).unwrap().modified().unwrap();
        thread::sleep(Duration::from_millis(20));
        touch_path(&dir_str).unwrap();
        let after = fs::metadata(&dir).unwrap().modified().unwrap();
        assert!(after >= before);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn touch_path_rejects_missing() {
        let err = touch_path("/tmp/collector-fs-touch-missing-path-should-not-exist").unwrap_err();
        assert!(err.contains("does not exist"));
    }

    #[test]
    fn item_media_dir_name_appends_suffix() {
        assert_eq!(item_media_dir_name("note.md").unwrap(), "note.media");
        assert_eq!(item_media_dir_name("Inbox/note.md").unwrap(), "note.media");
        assert!(item_media_dir_name("note").is_err());
    }

    #[test]
    fn walk_items_skips_reserved_entries_and_media_dirs() {
        let dir = tempfile_dir("walk");
        fs::write(dir.join("vault.meta.json"), "{}").unwrap();
        fs::write(dir.join("root.md"), "# root").unwrap();
        fs::create_dir_all(dir.join("Inbox")).unwrap();
        fs::write(dir.join("Inbox/note.md"), "# note").unwrap();
        fs::create_dir_all(dir.join("Inbox/note.media")).unwrap();
        fs::write(dir.join("Inbox/note.media/manifest.json"), "{}").unwrap();

        let mut items = Vec::new();
        walk_items(Path::new(&dir), "", &mut items).unwrap();
        items.sort();
        assert_eq!(items, vec!["Inbox/note.md".to_string(), "root.md".to_string()]);

        let _ = fs::remove_dir_all(&dir);
    }

    fn tempfile_dir(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "collector-fs-{}-{}",
            label,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }
}
