mod vault_fs;

use vault_fs::{
    resolve_item_thumbnail_paths, vault_items_read_meta, vault_items_stat_meta,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            vault_items_stat_meta,
            vault_items_read_meta,
            resolve_item_thumbnail_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
