//! Packaged Collector service sidecar entry (#165 / #166 / #167 / epic #142).
//!
//! Bundled into the desktop installer via Tauri `externalBin`.
//! The app does **not** spawn this on the default path (#166 flag is OFF).
//!
//! `serve` holds the process until the OS delivers SIGTERM/SIGINT/SIGKILL and
//! opens **no** SQLite — supervise smokes cannot create a dual-writer.
//! Real domain host remains the Node CLI until cutover.
//!
//! Sole-writer lock (#167): `serve` acquires `{data-dir}/collector-service.lock`.

use collector_lib::service_lock::{acquire_service_lock, LockError};
use std::path::Path;
use std::thread;
use std::time::Duration;

fn usage() -> ! {
    eprintln!(
        "Usage:\n  collector-service --version\n  collector-service serve --data-dir <path> [options]\n\n\
         This binary is an internal app sidecar (not a user-facing daemon).\n\
         Default Collector runs still use the in-process index path.\n\
         App supervise spawn is behind COLLECTOR_ENABLE_SERVICE_SUPERVISE=1 (#166)."
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
    eprintln!("collector-service: idle serve placeholder (data-dir={data_dir}, no SQLite)");
    println!(
        "COLLECTOR_SERVICE_READY {{\"ok\":true,\"mode\":\"idle-placeholder\",\"dataDir\":{}}}",
        json_string(data_dir)
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
