//! Packaged Collector service sidecar entry (#165–#168 / epic #142).
//!
//! Bundled into the desktop installer via Tauri `externalBin`.
//! The app does **not** spawn this on the default path (#166 flag is OFF).
//!
//! `serve` holds the process until the OS delivers SIGTERM/SIGINT/SIGKILL and
//! opens **no** SQLite — supervise smokes cannot create a dual-writer.
//! Real domain host remains the Node CLI until cutover.
//!
//! Sole-writer lock (#167): `serve` acquires `{data-dir}/collector-service.lock`.
//! Logs (#168): `{data-dir}/logs/collector-service.log` (also via supervise stdio redirect).

use collector_lib::service_lock::{acquire_service_lock, LockError};
use collector_lib::service_logs::{
    append_service_log_line, service_log_path, verbose_enabled,
};
use std::path::Path;
use std::thread;
use std::time::Duration;

fn usage() -> ! {
    eprintln!(
        "Usage:\n  collector-service --version\n  collector-service serve --data-dir <path> [options]\n\n\
         This binary is an internal app sidecar (not a user-facing daemon).\n\
         Default Collector runs still use the in-process index path.\n\
         App supervise spawn is behind COLLECTOR_ENABLE_SERVICE_SUPERVISE=1 (#166).\n\
         Supervised logs: {{data-dir}}/logs/collector-service.log (#168)."
    );
    std::process::exit(2);
}

fn read_arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let idx = args.iter().position(|a| a == name)?;
    args.get(idx + 1).map(String::as_str)
}

fn json_string(value: &str) -> String {
    let mut out = String::from('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn serve(args: &[String]) -> ! {
    let Some(data_dir) = read_arg(args, "--data-dir") else {
        eprintln!("missing --data-dir");
        usage();
    };

    let _lock = match acquire_service_lock(Path::new(data_dir)) {
        Ok(guard) => guard,
        Err(LockError::AlreadyLocked { service_pid }) => {
            eprintln!("collector-service: lock held by pid {service_pid}");
            std::process::exit(3);
        }
        Err(LockError::Io(err)) => {
            eprintln!("collector-service: lock I/O: {err}");
            std::process::exit(1);
        }
    };

    // Idle placeholder: keep process alive for supervise tests. No DB open.
    let log_path = service_log_path(Path::new(data_dir));
    let _ = append_service_log_line(
        Path::new(data_dir),
        &format!(
            "collector-service: idle serve start pid={} data_dir={data_dir} verbose={}",
            std::process::id(),
            verbose_enabled()
        ),
    );
    eprintln!(
        "collector-service: idle serve placeholder (data-dir={data_dir}, no SQLite, log={})",
        log_path.display()
    );
    if verbose_enabled() {
        eprintln!("collector-service: verbose diagnostics on; tail -f {}", log_path.display());
    }
    println!(
        "COLLECTOR_SERVICE_READY {{\"ok\":true,\"mode\":\"idle-placeholder\",\"dataDir\":{},\"logPath\":{}}}",
        json_string(data_dir),
        json_string(&log_path.to_string_lossy())
    );

    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first() else {
        usage();
    };

    match command.as_str() {
        "--version" | "-V" | "version" => {
            println!("collector-service {}", env!("CARGO_PKG_VERSION"));
        }
        "serve" => serve(&args),
        "--help" | "-h" | "help" => usage(),
        other => {
            eprintln!("unknown command: {other}");
            usage();
        }
    }
}
