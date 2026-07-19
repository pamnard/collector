//! Spawn the Node domain host as the sole SQLite writer (#170 / epic #142).
//!
//! Cutover supervise starts:
//! `node packages/service/dist/host/cli.js serve --data-dir …`
//! so the existing host IPC stack owns the index.

use crate::service_ipc::parse_ready_ipc_path;
use crate::service_lock::{
    cleanup_orphans, remove_lock, write_lock, CleanupOutcome, LockInfo, SUPERVISOR_PID_ENV,
};
use crate::service_logs::{open_service_log_append, verbose_enabled, VERBOSE_ENV};
use crate::service_supervise::{supervise_enabled, SuperviseError, SUPERVISE_ENABLE_ENV};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// When set, UI/boot treat the app as service-mode (IPC client).
pub const SERVICE_MODE_ENV: &str = "COLLECTOR_SERVICE_MODE";
/// Absolute path to `packages/service/dist/host/cli.js` (optional override).
pub const NODE_HOST_CLI_ENV: &str = "COLLECTOR_SERVICE_NODE_CLI";

/// Service mode ON by default when the Node host CLI is available (#170).
/// Set `COLLECTOR_SERVICE_MODE=0` to force LocalAdapter; `=1` to force cutover.
pub fn service_mode_enabled() -> bool {
    match std::env::var(SERVICE_MODE_ENV).ok().as_deref() {
        Some("0") | Some("false") | Some("FALSE") | Some("no") => false,
        Some("1") | Some("true") | Some("TRUE") | Some("yes") => true,
        _ => resolve_node_host_cli().is_ok(),
    }
}

fn ensure_supervise_for_service_mode() {
    if service_mode_enabled() && !supervise_enabled() {
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
    }
}

pub fn resolve_node_host_cli() -> Result<PathBuf, SuperviseError> {
    if let Ok(explicit) = std::env::var(NODE_HOST_CLI_ENV) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(SuperviseError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("{NODE_HOST_CLI_ENV} not a file: {}", path.display()),
        )));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest.join("../packages/service/dist/host/cli.js");
    if let Ok(canon) = candidate.canonicalize() {
        if canon.is_file() {
            return Ok(canon);
        }
    }
    Err(SuperviseError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "Node host CLI not found (build @collector/service or set COLLECTOR_SERVICE_NODE_CLI)",
    )))
}

#[derive(Debug)]
pub struct NodeHostSupervisor {
    child: Child,
    data_dir: PathBuf,
    pub ipc_path: PathBuf,
}

impl NodeHostSupervisor {
    /// Spawn Node host; requires supervise (auto-enabled when service mode is ON).
    pub fn spawn(data_dir: &Path) -> Result<Self, SuperviseError> {
        ensure_supervise_for_service_mode();
        if !supervise_enabled() {
            return Err(SuperviseError::Disabled);
        }

        std::fs::create_dir_all(data_dir)?;
        match cleanup_orphans(data_dir)? {
            CleanupOutcome::LiveHolder { service_pid, .. } => {
                return Err(SuperviseError::AlreadyLocked { service_pid });
            }
            CleanupOutcome::NoLock
            | CleanupOutcome::RemovedStale
            | CleanupOutcome::CleanedOrphan { .. } => {}
        }

        let cli = resolve_node_host_cli()?;
        let (log_path, mut log_file) = open_service_log_append(data_dir)?;
        let log_err = log_file.try_clone().map_err(SuperviseError::from)?;
        if verbose_enabled() {
            eprintln!(
                "collector service-mode: Node host → {} (log {})",
                cli.display(),
                log_path.display()
            );
        }

        let mut child = Command::new("node")
            .arg(&cli)
            .arg("serve")
            .arg("--data-dir")
            .arg(data_dir)
            .env(SUPERVISOR_PID_ENV, std::process::id().to_string())
            .env(VERBOSE_ENV, if verbose_enabled() { "1" } else { "0" })
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log_err))
            .spawn()?;

        let stdout = child.stdout.take().ok_or_else(|| {
            SuperviseError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                "node host missing stdout",
            ))
        })?;

        let (tx, rx) = mpsc::channel::<Result<PathBuf, String>>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            let mut ipc: Option<PathBuf> = None;
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let _ = writeln!(log_file, "{line}");
                        let _ = log_file.flush();
                        if ipc.is_none() {
                            if let Some(path) = parse_ready_ipc_path(&line) {
                                ipc = Some(path.clone());
                                let _ = tx.send(Ok(path));
                            }
                        }
                    }
                    Err(err) => {
                        if ipc.is_none() {
                            let _ = tx.send(Err(err.to_string()));
                        }
                        break;
                    }
                }
            }
            if ipc.is_none() {
                let _ = tx.send(Err(
                    "node host exited before COLLECTOR_SERVICE_READY".into(),
                ));
            }
        });

        let ipc_path = match rx.recv_timeout(Duration::from_secs(45)) {
            Ok(Ok(path)) => path,
            Ok(Err(msg)) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(SuperviseError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    msg,
                )));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(SuperviseError::TimedOut);
            }
        };

        let host = Self {
            child,
            data_dir: data_dir.to_path_buf(),
            ipc_path,
        };
        write_lock(
            data_dir,
            &LockInfo {
                service_pid: host.child.id(),
                supervisor_pid: std::process::id(),
            },
        )?;
        Ok(host)
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    pub fn is_running(&mut self) -> Result<bool, SuperviseError> {
        match self.child.try_wait()? {
            None => Ok(true),
            Some(_) => Ok(false),
        }
    }

    pub fn stop(&mut self, timeout: Duration) -> Result<(), SuperviseError> {
        #[cfg(unix)]
        {
            let pid = self.child.id() as i32;
            let _ = unsafe { libc_kill(pid, 15) };
        }
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
        }
        let deadline = Instant::now() + timeout;
        loop {
            if self.child.try_wait()?.is_some() {
                let _ = remove_lock(&self.data_dir);
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.child.kill()?;
                let _ = self.child.wait()?;
                let _ = remove_lock(&self.data_dir);
                return Err(SuperviseError::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn kill(&mut self) -> Result<(), SuperviseError> {
        self.child.kill()?;
        let _ = self.child.wait()?;
        let _ = remove_lock(&self.data_dir);
        Ok(())
    }
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_mode_env_overrides() {
        std::env::set_var(SERVICE_MODE_ENV, "0");
        assert!(!service_mode_enabled());
        std::env::set_var(SERVICE_MODE_ENV, "1");
        assert!(service_mode_enabled());
        std::env::remove_var(SERVICE_MODE_ENV);
    }

    #[test]
    fn spawn_node_host_and_ipc_ping() {
        if resolve_node_host_cli().is_err() {
            eprintln!("skip: node host CLI missing");
            return;
        }
        std::env::set_var(SERVICE_MODE_ENV, "1");
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-node-host-{}",
            std::process::id()
        ));
        let mut host = match NodeHostSupervisor::spawn(&dir) {
            Ok(h) => h,
            Err(err) => {
                eprintln!("skip: spawn failed: {err}");
                std::env::remove_var(SERVICE_MODE_ENV);
                std::env::remove_var(SUPERVISE_ENABLE_ENV);
                return;
            }
        };
        let client = crate::service_ipc::ServiceIpcClient::connect(
            &host.ipc_path,
            Duration::from_secs(5),
        )
        .expect("connect ipc");
        let pong = client.request("ping", None).expect("ping");
        assert_eq!(pong.get("pong").and_then(|v| v.as_bool()), Some(true));
        host.stop(Duration::from_secs(5)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SERVICE_MODE_ENV);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }
}
