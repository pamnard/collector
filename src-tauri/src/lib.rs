mod vault_fs;
mod vault_watcher;

use vault_fs::{
    fs_touch, fs_write_text_exclusive, resolve_item_thumbnail_paths, vault_items_read_meta,
    vault_items_stat_meta,
};
use vault_watcher::{
    start_vault_items_watcher, stop_vault_items_watcher, VaultWatcherState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultWatcherState::new())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            vault_items_stat_meta,
            vault_items_read_meta,
            resolve_item_thumbnail_paths,
            fs_touch,
            fs_write_text_exclusive,
            start_vault_items_watcher,
            stop_vault_items_watcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
