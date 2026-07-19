//! Service process logs / diagnostics for supervised runs (#168 / epic #142).
//!
//! # Where logs go
//!
//! Under the service `--data-dir`:
//!
//! ```text
//! {data-dir}/logs/collector-service.log
//! ```
//!
//! Supervised spawn (`COLLECTOR_ENABLE_SERVICE_SUPERVISE=1`) redirects the
//! sidecar's stdout and stderr into that file (append). The idle placeholder
//! also appends a startup line so the file exists even if stdio is quiet.
//!
//! # Host vs UI
//!
//! - **Default product path:** UI keeps the in-process index; the sidecar is
//!   not spawned. There is nothing to tail.
//! - **Supervised / future cutover:** attach to `{data-dir}/logs/collector-service.log`
//!   (e.g. `tail -f`). The Node domain host (`@collector/service` CLI) is a
//!   separate process with its own stdout until cutover replaces it.
//!
//! # Verbose
//!
//! Set `COLLECTOR_SERVICE_VERBOSE=1` to print the log path on supervise spawn
//! (parent stderr) and to ask the sidecar for a slightly noisier startup line.
//! No effect on the default user-facing app path.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const VERBOSE_ENV: &str = "COLLECTOR_SERVICE_VERBOSE";
pub const LOG_DIR_NAME: &str = "logs";
pub const LOG_FILE_NAME: &str = "collector-service.log";

pub fn verbose_enabled() -> bool {
    matches!(
        std::env::var(VERBOSE_ENV).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes")
    )
}

pub fn service_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_DIR_NAME).join(LOG_FILE_NAME)
}

pub fn ensure_service_log_file(data_dir: &Path) -> Result<PathBuf, io::Error> {
    let path = service_log_path(data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if !path.is_file() {
        File::create(&path)?;
    }
    Ok(path)
}

/// Open the service log for append (creates `logs/` as needed).
pub fn open_service_log_append(data_dir: &Path) -> Result<(PathBuf, File), io::Error> {
    let path = ensure_service_log_file(data_dir)?;
    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    Ok((path, file))
}

pub fn append_service_log_line(data_dir: &Path, line: &str) -> Result<(), io::Error> {
    let (path, mut file) = open_service_log_append(data_dir)?;
    let _ = path;
    writeln!(file, "{line}")?;
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_path_under_data_dir_logs() {
        let dir = Path::new("/tmp/collector-data-example");
        assert_eq!(
            service_log_path(dir),
            PathBuf::from("/tmp/collector-data-example/logs/collector-service.log")
        );
    }

    #[test]
    fn ensure_creates_file() {
        let dir = std::env::temp_dir().join(format!(
            "collector-logs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        let path = ensure_service_log_file(&dir).expect("ensure");
        assert!(path.is_file());
        append_service_log_line(&dir, "hello-diag").expect("append");
        let text = fs::read_to_string(&path).expect("read");
        assert!(text.contains("hello-diag"));
        let _ = fs::remove_dir_all(dir);
    }
}
