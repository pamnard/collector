mod vault_fs;
mod vault_watcher;
pub mod service_domain_host;
pub mod service_ipc;
pub mod service_lock;
pub mod service_logs;
pub mod service_mode;
pub mod service_supervise;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;

use service_ipc::{ServiceIpcClient, ServiceIpcState};
use service_mode::{bootstrap_service_mode, service_mode_enabled};
use service_supervise::{
    supervise_enabled, PackagedHostRuntime, ServiceSupervisor, SUPERVISE_ENABLE_ENV,
};
use vault_fs::{
    fs_touch, fs_write_text_exclusive, resolve_item_thumbnail_paths, vault_items_read_meta,
    vault_items_read_source_refs, vault_items_stat_meta,
};
use vault_watcher::{
    start_vault_items_watcher, stop_vault_items_watcher, VaultWatcherState,
};

struct ServiceSuperviseState {
    supervisor: Mutex<Option<ServiceSupervisor>>,
}

pub(crate) fn host_target_triple() -> Result<String, String> {
    // Tauri may export TAURI_ENV_TARGET_TRIPLE="" into the parent shell; treat
    // empty as unset so release-smoke / plain binary launches still resolve.
    if let Ok(triple) = std::env::var("TAURI_ENV_TARGET_TRIPLE") {
        let trimmed = triple.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    let out = std::process::Command::new("rustc")
        .args(["--print", "host-tuple"])
        .output()
        .map_err(|e| format!("rustc host-tuple: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "rustc --print host-tuple failed (status={})",
            out.status
        ));
    }
    let triple = String::from_utf8(out.stdout)
        .map_err(|e| format!("rustc host-tuple utf8: {e}"))?
        .trim()
        .to_string();
    if triple.is_empty() {
        return Err("rustc --print host-tuple returned empty".into());
    }
    Ok(triple)
}

fn resolve_sidecar_bin(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Packaged / `tauri build` output: sidecar sits next to the app binary as
    // `collector-service`. Prefer both Tauri executable_dir and current_exe
    // parent — release-smoke launches `target/release/collector` where the
    // sibling binary exists even if executable_dir differs under xvfb.
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe_dir) = app.path().executable_dir() {
        dirs.push(exe_dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
        }
    }
    for dir in &dirs {
        let packaged = dir.join("collector-service");
        if packaged.is_file() {
            return Ok(packaged);
        }
        #[cfg(windows)]
        {
            let packaged_exe = dir.join("collector-service.exe");
            if packaged_exe.is_file() {
                return Ok(packaged_exe);
            }
        }
    }
    // Dev: src-tauri/binaries/collector-service-$triple from prepare script.
    let triple = host_target_triple()?;
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("collector-service-{triple}"));
    if dev.is_file() {
        return Ok(dev);
    }
    Err(format!(
        "collector-service sidecar not found (packaged next to app or at {})",
        dev.display()
    ))
}

/// Relative markers for `collector-service-host/cli.js` under a search root.
///
/// Linux `.deb`: Tauri `resource_dir()` is `/usr/lib/<ProductName>` (see
/// tauri-utils `resource_dir_from`), while bundle resources land in
/// `resource_dir/resources/…`. Flat `resource_dir/collector-service-host`
/// covers Windows / `target/release` layouts.
fn packaged_host_cli_candidates(root: &std::path::Path) -> [PathBuf; 2] {
    [
        root.join("collector-service-host/cli.js"),
        root.join("resources/collector-service-host/cli.js"),
    ]
}

fn packaged_host_from_cli(cli: PathBuf) -> Result<PackagedHostRuntime, String> {
    let host_dir = cli
        .parent()
        .ok_or_else(|| format!("packaged host cli has no parent: {}", cli.display()))?
        .to_path_buf();
    #[cfg(windows)]
    let node = host_dir.join("node.exe");
    #[cfg(not(windows))]
    let node = host_dir.join("node");
    if !node.is_file() {
        return Err(format!(
            "packaged host marker {} present but bundled node missing at {}",
            cli.display(),
            node.display()
        ));
    }
    Ok(PackagedHostRuntime {
        node_cli: cli.canonicalize().unwrap_or(cli),
        node_bin: node.canonicalize().unwrap_or(node),
    })
}

/// Pure resolver used by [`resolve_packaged_host_runtime`] (unit-tested).
fn find_packaged_host_in_roots(roots: &[PathBuf]) -> Result<Option<PackagedHostRuntime>, String> {
    let mut saw_host_dir_without_cli: Option<PathBuf> = None;
    for root in roots {
        for cli in packaged_host_cli_candidates(root) {
            if cli.is_file() {
                return Ok(Some(packaged_host_from_cli(cli)?));
            }
            if let Some(host_dir) = cli.parent() {
                if host_dir.is_dir() {
                    saw_host_dir_without_cli = Some(host_dir.to_path_buf());
                }
            }
        }
    }
    if let Some(dir) = saw_host_dir_without_cli {
        return Err(format!(
            "packaged host dir {} exists but collector-service-host/cli.js is missing",
            dir.display()
        ));
    }
    Ok(None)
}

/// Locate packaged `collector-service-host/cli.js` under Tauri resource_dir (or
/// next to the executable for `target/release` layouts). Marker is **cli.js** —
/// a bare resource_dir without that file is not "packaged present".
///
/// Do **not** search `CARGO_MANIFEST_DIR/resources`: that false-greens release
/// smoke on the build machine while installed `.deb` still fails inject.
fn resolve_packaged_host_runtime(
    app: &tauri::AppHandle,
) -> Result<Option<PackagedHostRuntime>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        roots.push(resource_dir);
    }
    if let Ok(exe_dir) = app.path().executable_dir() {
        roots.push(exe_dir.clone());
        roots.push(exe_dir.join("resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("resources"));
        }
    }
    find_packaged_host_in_roots(&roots)
}

#[cfg(test)]
mod packaged_host_resolve_tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_host_under_linux_deb_resource_dir_layout() {
        let root = std::env::temp_dir().join(format!(
            "collector-linux-host-{}",
            std::process::id()
        ));
        let host = root.join("resources/collector-service-host");
        fs::create_dir_all(&host).unwrap();
        fs::write(host.join("cli.js"), b"// marker").unwrap();
        #[cfg(windows)]
        fs::write(host.join("node.exe"), b"").unwrap();
        #[cfg(not(windows))]
        {
            fs::write(host.join("node"), b"").unwrap();
            // executable bit not required for is_file()
        }
        let found = find_packaged_host_in_roots(std::slice::from_ref(&root))
            .expect("resolve")
            .expect("must find packaged host");
        assert!(found.node_cli.ends_with("cli.js"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn misses_when_only_lib_root_without_resources_subdir() {
        let root = std::env::temp_dir().join(format!(
            "collector-linux-host-miss-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let found = find_packaged_host_in_roots(std::slice::from_ref(&root)).expect("resolve");
        assert!(found.is_none());
        let _ = fs::remove_dir_all(root);
    }
}

#[tauri::command]
fn service_supervise_is_enabled() -> bool {
    supervise_enabled()
}

#[tauri::command]
fn service_supervise_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceSuperviseState>,
    data_dir: String,
) -> Result<u32, String> {
    if !supervise_enabled() {
        return Err(format!(
            "service supervise disabled (set {SUPERVISE_ENABLE_ENV}=1)"
        ));
    }
    let sidecar = resolve_sidecar_bin(&app)?;
    let packaged_host = resolve_packaged_host_runtime(&app)?;
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.as_mut() {
        if existing.is_running().map_err(|e| e.to_string())? {
            return Ok(existing.pid());
        }
    }
    let sup = ServiceSupervisor::spawn(
        &sidecar,
        PathBuf::from(data_dir).as_path(),
        None,
        packaged_host.as_ref(),
    )
    .map_err(|e| e.to_string())?;
    let pid = sup.pid();
    *guard = Some(sup);
    Ok(pid)
}

#[tauri::command]
fn service_supervise_stop(
    state: tauri::State<'_, ServiceSuperviseState>,
) -> Result<(), String> {
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    let Some(sup) = guard.as_mut() else {
        return Ok(());
    };
    sup.stop(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn service_supervise_kill(
    state: tauri::State<'_, ServiceSuperviseState>,
) -> Result<(), String> {
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    let Some(sup) = guard.as_mut() else {
        return Ok(());
    };
    sup.kill().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
fn service_ipc_connect(
    ipc_state: tauri::State<'_, ServiceIpcState>,
    ipc_path: String,
) -> Result<String, String> {
    let path = PathBuf::from(&ipc_path);
    let client = ServiceIpcClient::connect(&path, Duration::from_secs(15))
        .map_err(|e| e.to_string())?;
    let mut guard = ipc_state.client.lock().map_err(|e| e.to_string())?;
    if let Some(existing) = guard.take() {
        let _ = existing.close();
    }
    *guard = Some(Arc::new(client));
    *ipc_state.ipc_path.lock().map_err(|e| e.to_string())? = Some(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn service_ipc_request(
    ipc_state: tauri::State<'_, ServiceIpcState>,
    method: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let guard = ipc_state.client.lock().map_err(|e| e.to_string())?;
    let client = guard
        .as_ref()
        .ok_or("service IPC not connected (call service_ipc_connect)")?;
    client.request(&method, params).map_err(|e| e.to_string())
}

#[tauri::command]
fn service_ipc_disconnect(
    ipc_state: tauri::State<'_, ServiceIpcState>,
) -> Result<(), String> {
    if let Some(client) = ipc_state.client.lock().map_err(|e| e.to_string())?.take() {
        let _ = client.close();
    }
    *ipc_state.ipc_path.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
fn service_mode_is_enabled() -> bool {
    service_mode_enabled()
}

#[tauri::command]
fn service_mode_bootstrap(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServiceSuperviseState>,
    data_dir: String,
    config_dir: String,
) -> Result<String, String> {
    let sidecar = resolve_sidecar_bin(&app)?;
    let packaged_host = resolve_packaged_host_runtime(&app)?;
    let mut guard = state.supervisor.lock().map_err(|e| e.to_string())?;
    let ipc = bootstrap_service_mode(
        &sidecar,
        PathBuf::from(data_dir).as_path(),
        PathBuf::from(config_dir).as_path(),
        &mut guard,
        packaged_host.as_ref(),
    )?;
    Ok(ipc.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Cutover (#170): service mode default-ON; opt out with COLLECTOR_SERVICE_MODE=0.
    tauri::Builder::default()
        .manage(VaultWatcherState::new())
        .manage(ServiceSuperviseState {
            supervisor: Mutex::new(None),
        })
        .manage(ServiceIpcState::new())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            vault_items_stat_meta,
            vault_items_read_meta,
            vault_items_read_source_refs,
            resolve_item_thumbnail_paths,
            fs_touch,
            fs_write_text_exclusive,
            start_vault_items_watcher,
            stop_vault_items_watcher,
            service_supervise_is_enabled,
            service_supervise_spawn,
            service_supervise_stop,
            service_supervise_kill,
            service_ipc_connect,
            service_ipc_request,
            service_ipc_disconnect,
            service_mode_is_enabled,
            service_mode_bootstrap,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
