use filetime::{set_file_mtime, FileTime};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const ITEMS_DIR: &str = "items";
const ITEM_META_FILE: &str = "item.json";
const MEDIA_DIR: &str = "media";
const MEDIA_MANIFEST_FILE: &str = "manifest.json";

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
    pub item_json: String,
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

fn items_dir(vault_path: &str) -> PathBuf {
    Path::new(vault_path).join(ITEMS_DIR)
}

fn item_meta_path(items_dir: &Path, item_id: &str) -> PathBuf {
    items_dir.join(item_id).join(ITEM_META_FILE)
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis() as i64)
}

#[tauri::command]
pub fn vault_items_stat_meta(vault_path: String) -> Result<Vec<VaultItemStatMeta>, String> {
    let items_dir = items_dir(&vault_path);
    if !items_dir.is_dir() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&items_dir).map_err(|error| error.to_string())?;
    let mut results = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().into_owned();
        let meta_path = item_meta_path(&items_dir, &id);
        let mtime_ms = if meta_path.is_file() {
            mtime_ms(&meta_path)
        } else {
            None
        };

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

    let items_dir = items_dir(&vault_path);
    let mut results = Vec::with_capacity(ids.len());

    for id in ids {
        let meta_path = item_meta_path(&items_dir, &id);
        if !meta_path.is_file() {
            continue;
        }

        let item_json =
            fs::read_to_string(&meta_path).map_err(|error| format!("{id}: {error}"))?;
        results.push(VaultItemMetaRead { id, item_json });
    }

    Ok(results)
}

fn item_root_path(vault_path: &str, item_id: &str) -> PathBuf {
    items_dir(vault_path).join(item_id)
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

    let mut resolved = item_root_path(vault_path, item_id);
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

fn media_file_path(item_root: &Path, media_id: &str, filename: &str) -> PathBuf {
    let stored = format!("{}-{}", media_id, sanitize_media_filename(filename));
    item_root.join(MEDIA_DIR).join(stored)
}

fn first_image_media_path(item_root: &Path) -> Option<PathBuf> {
    let manifest_path = item_root.join(MEDIA_DIR).join(MEDIA_MANIFEST_FILE);
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

        let candidate = media_file_path(item_root, &file.id, &file.filename);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn resolve_one_thumbnail(vault_path: &str, item: &ThumbnailResolveItem) -> ThumbnailResolveResult {
    let item_root = item_root_path(vault_path, &item.id);

    if let Some(thumbnail) = item.thumbnail.as_deref().filter(|value| !value.is_empty()) {
        let candidate = resolve_thumbnail_absolute(vault_path, &item.id, thumbnail);
        if candidate.is_file() {
            return ThumbnailResolveResult {
                id: item.id.clone(),
                path: Some(candidate.to_string_lossy().into_owned()),
            };
        }
    }

    let path = first_image_media_path(&item_root)
        .map(|candidate| candidate.to_string_lossy().into_owned());
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
mod touch_tests {
    use super::touch_path;
    use std::fs;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn touch_path_updates_directory_mtime() {
        let dir = tempfile_dir();
        let before = fs::metadata(&dir).unwrap().modified().unwrap();
        thread::sleep(Duration::from_millis(20));
        touch_path(&dir).unwrap();
        let after = fs::metadata(&dir).unwrap().modified().unwrap();
        assert!(after >= before);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn touch_path_rejects_missing() {
        let err = touch_path("/tmp/collector-fs-touch-missing-path-should-not-exist").unwrap_err();
        assert!(err.contains("does not exist"));
    }

    fn tempfile_dir() -> String {
        let path = std::env::temp_dir().join(format!(
            "collector-fs-touch-{}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().into_owned()
    }
}
