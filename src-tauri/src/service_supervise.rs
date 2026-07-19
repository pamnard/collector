//! Service process supervise helpers (#166 / #167 / #168 / epic #142).
//!
//! Dead by default: [`supervise_enabled`] is false unless
//! `COLLECTOR_ENABLE_SERVICE_SUPERVISE=1`. Callers must check the flag before
//! spawn — the desktop app startup path must not call spawn when disabled
//! (no second SQLite writer / no dual process).
//!
//! Spawn runs orphan cleanup (#167) and refuses when a live lock holder remains.
//! Child stdout/stderr append to `{data-dir}/logs/collector-service.log` (#168).

use crate::service_lock::{
    cleanup_orphans, CleanupOutcome, SUPERVISOR_PID_ENV,
};
use crate::service_logs::{
    open_service_log_append, service_log_path, verbose_enabled, VERBOSE_ENV,
};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Env flag that unlocks supervise spawn/stop for smokes and future cutover.
pub const SUPERVISE_ENABLE_ENV: &str = "COLLECTOR_ENABLE_SERVICE_SUPERVISE";

pub fn supervise_enabled() -> bool {
    matches!(
        std::env::var(SUPERVISE_ENABLE_ENV).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

#[derive(Debug)]
pub struct ServiceSupervisor {
    child: Child,
    data_dir: PathBuf,
}

#[derive(Debug)]
pub enum SuperviseError {
    Disabled,
    AlreadyLocked { service_pid: u32 },
    Io(io::Error),
    NotRunning,
    TimedOut,
}

impl std::fmt::Display for SuperviseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => write!(
                f,
                "service supervise disabled (set {SUPERVISE_ENABLE_ENV}=1 to enable)"
            ),
            Self::AlreadyLocked { service_pid } => {
                write!(f, "service lock already held by pid {service_pid}")
            }
            Self::Io(err) => write!(f, "service supervise I/O: {err}"),
            Self::NotRunning => write!(f, "service process is not running"),
            Self::TimedOut => write!(f, "timed out waiting for service process"),
        }
    }
}

impl std::error::Error for SuperviseError {}

impl From<io::Error> for SuperviseError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

impl ServiceSupervisor {
    /// Spawn `collector-service serve --data-dir …`. Refuses when flag is OFF.
    ///
    /// Runs [`cleanup_orphans`] first; a live lock holder blocks spawn.
    pub fn spawn(sidecar_bin: &Path, data_dir: &Path) -> Result<Self, SuperviseError> {
        if !supervise_enabled() {
            return Err(SuperviseError::Disabled);
        }
        if !sidecar_bin.is_file() {
            return Err(SuperviseError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                format!("sidecar binary not found: {}", sidecar_bin.display()),
            )));
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
        let (log_path, log_file) = open_service_log_append(data_dir)?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|e| SuperviseError::Io(e))?;
        if verbose_enabled() {
            eprintln!(
                "collector supervise: service log → {} (set {VERBOSE_ENV}=0 to silence)",
                log_path.display()
            );
        }
        let mut cmd = Command::new(sidecar_bin);
        cmd.arg("serve")
            .arg("--data-dir")
            .arg(data_dir)
            .env(SUPERVISOR_PID_ENV, std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));
        if verbose_enabled() {
            cmd.env(VERBOSE_ENV, "1");
        }
        let child = cmd.spawn()?;
        Ok(Self {
            child,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn log_path(&self) -> PathBuf {
        service_log_path(&self.data_dir)
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

    /// Ask the child to exit (SIGTERM on Unix) and wait up to `timeout`.
    pub fn stop(&mut self, timeout: Duration) -> Result<(), SuperviseError> {
        #[cfg(unix)]
        {
            let pid = self.child.id() as i32;
            // Best-effort SIGTERM of our child; fall through to wait_timeout.
            let _ = libc_kill(pid, 15);
        }
        #[cfg(not(unix))]
        {
            let _ = self.child.kill();
        }
        self.wait_timeout(timeout)
    }

    pub fn kill(&mut self) -> Result<(), SuperviseError> {
        self.child.kill()?;
        let _ = self.child.wait()?;
        Ok(())
    }

    pub fn wait(&mut self) -> Result<std::process::ExitStatus, SuperviseError> {
        Ok(self.child.wait()?)
    }

    fn wait_timeout(&mut self, timeout: Duration) -> Result<(), SuperviseError> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(_status) = self.child.try_wait()? {
                return Ok(());
            }
            if Instant::now() >= deadline {
                self.child.kill()?;
                let _ = self.child.wait()?;
                return Err(SuperviseError::TimedOut);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(unix)]
fn libc_kill(pid: i32, sig: i32) -> i32 {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    // SAFETY: kill(2) on our supervised child pid only.
    unsafe { kill(pid, sig) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn host_triple() -> String {
        let out = Command::new("rustc")
            .args(["--print", "host-tuple"])
            .output()
            .expect("rustc host-tuple");
        String::from_utf8(out.stdout)
            .expect("utf8")
            .trim()
            .to_string()
    }

    fn sidecar_path() -> PathBuf {
        let triple = host_triple();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        root.join(format!("binaries/collector-service-{triple}"))
    }

    #[test]
    fn spawn_refuses_when_flag_off() {
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
        let err = ServiceSupervisor::spawn(Path::new("/bin/true"), Path::new("/tmp")).unwrap_err();
        assert!(matches!(err, SuperviseError::Disabled));
    }

    #[test]
    fn spawn_stop_when_flag_on() {
        let sidecar = sidecar_path();
        if !sidecar.is_file() {
            eprintln!("skip: sidecar missing at {} (run prepare:service-sidecar)", sidecar.display());
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-{}",
            std::process::id()
        ));
        let mut sup = ServiceSupervisor::spawn(&sidecar, &dir).expect("spawn");
        assert!(sup.is_running().expect("running"));
        sup.stop(Duration::from_secs(3)).expect("stop");
        assert!(!sup.is_running().unwrap_or(false));
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }

    #[test]
    fn spawn_refuses_when_live_lock_held() {
        let sidecar = sidecar_path();
        if !sidecar.is_file() {
            eprintln!("skip: sidecar missing at {}", sidecar.display());
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-locked-{}",
            std::process::id()
        ));
        let mut first = ServiceSupervisor::spawn(&sidecar, &dir).expect("first spawn");
        assert!(first.is_running().expect("running"));

        // Wait until child writes the lock so cleanup sees a live holder.
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if crate::service_lock::read_lock(&dir)
                .ok()
                .and_then(|v| v)
                .is_some()
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }

        let err = ServiceSupervisor::spawn(&sidecar, &dir).expect_err("second must fail");
        assert!(matches!(err, SuperviseError::AlreadyLocked { .. }));

        first.stop(Duration::from_secs(3)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }

    #[test]
    fn spawn_writes_service_log_file() {
        let sidecar = sidecar_path();
        if !sidecar.is_file() {
            eprintln!("skip: sidecar missing at {}", sidecar.display());
            return;
        }
        std::env::set_var(SUPERVISE_ENABLE_ENV, "1");
        let dir = std::env::temp_dir().join(format!(
            "collector-supervise-logs-{}",
            std::process::id()
        ));
        let mut sup = ServiceSupervisor::spawn(&sidecar, &dir).expect("spawn");
        let log = service_log_path(&dir);
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut body = String::new();
        while Instant::now() < deadline {
            if log.is_file() {
                body = std::fs::read_to_string(&log).unwrap_or_default();
                if body.contains("COLLECTOR_SERVICE_READY")
                    || body.contains("idle serve")
                {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(log.is_file(), "expected log at {}", log.display());
        assert!(
            body.contains("COLLECTOR_SERVICE_READY") || body.contains("idle serve"),
            "log body: {body:?}"
        );
        assert_eq!(sup.log_path(), log);
        sup.stop(Duration::from_secs(3)).expect("stop");
        let _ = std::fs::remove_dir_all(dir);
        std::env::remove_var(SUPERVISE_ENABLE_ENV);
    }
}
