//! Packaged Collector service sidecar entry (#165–#168 / #237 / epic #142 / #554).
//!
//! Bundled into the desktop installer via Tauri `externalBin`.
//! The app does **not** spawn this on the default path (#166 flag is OFF).
//!
//! `serve` launches the real Node domain host (`packages/service` CLI): that
//! child acquires the sole-writer lock (#554), opens SQLite, and serves HTTP +
//! local IPC. READY is forwarded from the host (includes `ipcPath` / `baseUrl`).
//!
//! Logs (#168): `{data-dir}/logs/collector-service.log` (also via supervise stdio redirect).

use collector_lib::service_domain_host::run_domain_host_serve;
use collector_lib::service_logs::{
    append_service_log_line, service_log_path, verbose_enabled,
};
use std::path::Path;

fn usage() -> ! {
    eprintln!(
        "Usage:\n  collector-service --version\n  collector-service serve --data-dir <path> [options]\n\n\
         This binary is an internal app sidecar (not a user-facing daemon).\n\
         Default Collector runs still use the in-process index path.\n\
         App supervise spawn is behind COLLECTOR_ENABLE_SERVICE_SUPERVISE=1 (#166).\n\
         Supervised logs: {{data-dir}}/logs/collector-service.log (#168).\n\
         Domain host CLI: set COLLECTOR_SERVICE_NODE_CLI if auto-resolve fails (#237).
         Optional --config-dir: production settings root (#238); omit for self-contained profile.\n\
         Sole-writer lock is acquired by the Node host (#554), not this sidecar."
    );
    std::process::exit(2);
}

fn read_arg<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let idx = args.iter().position(|a| a == name)?;
    args.get(idx + 1).map(String::as_str)
}

fn serve(args: &[String]) -> ! {
    let Some(data_dir) = read_arg(args, "--data-dir") else {
        eprintln!("missing --data-dir");
        usage();
    };

    let log_path = service_log_path(Path::new(data_dir));
    let _ = append_service_log_line(
        Path::new(data_dir),
        &format!(
            "collector-service: domain host serve start pid={} data_dir={data_dir} verbose={}",
            std::process::id(),
            verbose_enabled()
        ),
    );
    eprintln!(
        "collector-service: launching domain host (data-dir={data_dir}, log={})",
        log_path.display()
    );
    if verbose_enabled() {
        eprintln!(
            "collector-service: verbose diagnostics on; tail -f {}",
            log_path.display()
        );
    }

    let config_dir = read_arg(args, "--config-dir").map(Path::new);
    match run_domain_host_serve(Path::new(data_dir), config_dir) {
        Ok(code) => std::process::exit(code),
        Err(err) => {
            eprintln!("collector-service: domain host failed: {err}");
            let _ = append_service_log_line(
                Path::new(data_dir),
                &format!("collector-service: domain host failed: {err}"),
            );
            std::process::exit(1);
        }
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
