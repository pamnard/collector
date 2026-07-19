//! Single-instance lock + orphan cleanup for the service writer (#167 / epic #142).
//!
//! Lock file lives under the service `--data-dir`. A live holder with a live
//! supervisor blocks takeover. A live service whose supervisor is gone is an
//! orphan and is cleaned on supervised start.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const LOCK_FILE_NAME: &str = "collector-service.lock";
pub const SUPERVISOR_PID_ENV: &str = "COLLECTOR_SERVICE_SUPERVISOR_PID";

const LOCK_MAGIC: &str = "COLLECTOR_SERVICE_LOCK_V1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockInfo {
    pub service_pid: u32,
    /// 0 = unknown / unset (fall back to process PPID for orphan checks).
    pub supervisor_pid: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum CleanupOutcome {
    NoLock,
    RemovedStale,
    CleanedOrphan { service_pid: u32 },
    /// Live service still owned by a live supervisor — do not take over.
    LiveHolder { service_pid: u32, supervisor_pid: u32 },
}

#[derive(Debug)]
pub enum LockError {
    AlreadyLocked { service_pid: u32 },
    Io(io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyLocked { service_pid } => {
                write!(f, "service lock already held by pid {service_pid}")
            }
            Self::Io(err) => write!(f, "service lock I/O: {err}"),
        }
    }
}

impl std::error::Error for LockError {}

impl From<io::Error> for LockError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

pub fn lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOCK_FILE_NAME)
}

pub fn read_lock(data_dir: &Path) -> Result<Option<LockInfo>, io::Error> {
    let path = lock_path(data_dir);
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    Ok(parse_lock(&text))
}

fn parse_lock(text: &str) -> Option<LockInfo> {
    let mut lines = text.lines();
    if lines.next()? != LOCK_MAGIC {
        return None;
    }
    let mut service_pid = None;
    let mut supervisor_pid = 0u32;
    for line in lines {
        if let Some(rest) = line.strip_prefix("service_pid=") {
            service_pid = rest.trim().parse().ok();
        } else if let Some(rest) = line.strip_prefix("supervisor_pid=") {
            supervisor_pid = rest.trim().parse().unwrap_or(0);
        }
    }
    Some(LockInfo {
        service_pid: service_pid?,
        supervisor_pid,
    })
}

fn format_lock(info: &LockInfo) -> String {
    format!(
        "{LOCK_MAGIC}\nservice_pid={}\nsupervisor_pid={}\n",
        info.service_pid, info.supervisor_pid
    )
}

pub fn write_lock(data_dir: &Path, info: &LockInfo) -> Result<(), io::Error> {
    fs::create_dir_all(data_dir)?;
    let path = lock_path(data_dir);
    let tmp = data_dir.join(format!("{LOCK_FILE_NAME}.tmp.{}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(format_lock(info).as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn remove_lock(data_dir: &Path) -> Result<(), io::Error> {
    let path = lock_path(data_dir);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) is a liveness probe; no signal delivered.
        unsafe { libc_kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

pub fn looks_like_collector_service(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        let Ok(bytes) = fs::read(format!("/proc/{pid}/cmdline")) else {
            return false;
        };
        let text = String::from_utf8_lossy(&bytes);
        text.split('\0').any(|part| {
            let base = Path::new(part)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(part);
            base.starts_with("collector-service")
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        // Non-Linux: trust lock file identity only (pid liveness).
        true
    }
}

fn process_ppid(pid: u32) -> Option<u32> {
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("PPid:") {
                return rest.trim().parse().ok();
            }
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        None
    }
}

/// Effective supervisor for orphan checks: explicit lock field, else PPID.
pub fn effective_supervisor_pid(info: &LockInfo) -> Option<u32> {
    if info.supervisor_pid != 0 {
        return Some(info.supervisor_pid);
    }
    process_ppid(info.service_pid)
}

fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        let _ = unsafe { libc_kill(pid as i32, 15) };
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while process_alive(pid) && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        if process_alive(pid) {
            let _ = unsafe { libc_kill(pid as i32, 9) };
            let _ = wait_brief(pid);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
    }
}

fn wait_brief(pid: u32) {
    let deadline = std::time::Instant::now() + Duration::from_millis(500);
    while process_alive(pid) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Clean stale locks / orphaned service processes for `data_dir`.
///
/// Does **not** kill a live service that still has a live supervisor.
pub fn cleanup_orphans(data_dir: &Path) -> Result<CleanupOutcome, io::Error> {
    let Some(info) = read_lock(data_dir)? else {
        return Ok(CleanupOutcome::NoLock);
    };

    if !process_alive(info.service_pid) || !looks_like_collector_service(info.service_pid) {
        remove_lock(data_dir)?;
        return Ok(CleanupOutcome::RemovedStale);
    }

    let supervisor = effective_supervisor_pid(&info);
    let supervisor_alive = supervisor.is_some_and(process_alive);
    if supervisor_alive {
        return Ok(CleanupOutcome::LiveHolder {
            service_pid: info.service_pid,
            supervisor_pid: supervisor.unwrap_or(0),
        });
    }

    kill_process(info.service_pid);
    remove_lock(data_dir)?;
    Ok(CleanupOutcome::CleanedOrphan {
        service_pid: info.service_pid,
    })
}

/// Acquire sole-writer lock for this process. Refuses if a live holder remains.
pub fn acquire_service_lock(data_dir: &Path) -> Result<ServiceLockGuard, LockError> {
    if let Some(info) = read_lock(data_dir)? {
        if process_alive(info.service_pid) && looks_like_collector_service(info.service_pid) {
            let supervisor = effective_supervisor_pid(&info);
            if supervisor.is_some_and(process_alive) {
                return Err(LockError::AlreadyLocked {
                    service_pid: info.service_pid,
                });
            }
            // Orphaned holder — reclaim.
            kill_process(info.service_pid);
        }
        remove_lock(data_dir)?;
    }

    let supervisor_pid = std::env::var(SUPERVISOR_PID_ENV)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let info = LockInfo {
        service_pid: std::process::id(),
        supervisor_pid,
    };
    write_lock(data_dir, &info)?;
    Ok(ServiceLockGuard {
        data_dir: data_dir.to_path_buf(),
    })
}

#[derive(Debug)]
pub struct ServiceLockGuard {
    data_dir: PathBuf,
}

impl ServiceLockGuard {
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}

impl Drop for ServiceLockGuard {
    fn drop(&mut self) {
        let _ = remove_lock(&self.data_dir);
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
    use std::process::Command;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "collector-lock-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn parse_roundtrip() {
        let info = LockInfo {
            service_pid: 42,
            supervisor_pid: 7,
        };
        let parsed = parse_lock(&format_lock(&info)).expect("parse");
        assert_eq!(parsed, info);
    }

    #[test]
    fn stale_lock_removed_when_pid_dead() {
        let dir = temp_dir();
        write_lock(
            &dir,
            &LockInfo {
                service_pid: 4_294_967_294,
                supervisor_pid: 4_294_967_293,
            },
        )
        .expect("write");
        assert_eq!(
            cleanup_orphans(&dir).expect("cleanup"),
            CleanupOutcome::RemovedStale
        );
        assert!(read_lock(&dir).expect("read").is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn live_holder_blocks_second_acquire() {
        let sidecar = {
            let triple = {
                let out = Command::new("rustc")
                    .args(["--print", "host-tuple"])
                    .output()
                    .expect("rustc");
                String::from_utf8(out.stdout).expect("utf8").trim().to_string()
            };
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(format!("binaries/collector-service-{triple}"))
        };
        if !sidecar.is_file() {
            eprintln!("skip: sidecar missing at {}", sidecar.display());
            return;
        }

        let dir = temp_dir();
        let supervisor = std::process::id();
        let mut child = Command::new(&sidecar)
            .arg("serve")
            .arg("--data-dir")
            .arg(&dir)
            .env(SUPERVISOR_PID_ENV, supervisor.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn service");

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if let Some(info) = read_lock(&dir).expect("read") {
                if info.service_pid == child.id() {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let info = read_lock(&dir).expect("read").expect("lock written by service");
        assert_eq!(info.service_pid, child.id());
        assert_eq!(info.supervisor_pid, supervisor);

        let err = acquire_service_lock(&dir).expect_err("second host must fail");
        assert!(matches!(err, LockError::AlreadyLocked { .. }));

        assert_eq!(
            cleanup_orphans(&dir).expect("cleanup"),
            CleanupOutcome::LiveHolder {
                service_pid: child.id(),
                supervisor_pid: supervisor,
            }
        );

        let _ = child.kill();
        let _ = child.wait();
        let _ = remove_lock(&dir);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn orphan_cleaned_when_supervisor_dead() {
        let sidecar = {
            let triple = {
                let out = Command::new("rustc")
                    .args(["--print", "host-tuple"])
                    .output()
                    .expect("rustc");
                String::from_utf8(out.stdout).expect("utf8").trim().to_string()
            };
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(format!("binaries/collector-service-{triple}"))
        };
        if !sidecar.is_file() {
            eprintln!("skip: sidecar missing at {}", sidecar.display());
            return;
        }

        let dir = temp_dir();
        let mut child = Command::new(&sidecar)
            .arg("serve")
            .arg("--data-dir")
            .arg(&dir)
            .env(SUPERVISOR_PID_ENV, "4294967294")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn service");

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            if read_lock(&dir).expect("read").is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(read_lock(&dir).expect("read").is_some());

        let outcome = cleanup_orphans(&dir).expect("cleanup orphan");
        assert!(matches!(outcome, CleanupOutcome::CleanedOrphan { .. }));
        assert!(read_lock(&dir).expect("read").is_none());
        // Reap so the pid is gone (zombie still counts as "alive" for kill(0)).
        let _ = child.wait();
        assert!(!process_alive(child.id()));

        let _ = fs::remove_dir_all(dir);
    }
}
