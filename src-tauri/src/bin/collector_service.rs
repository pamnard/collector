//! Packaged Collector service sidecar entry (#165 / epic #142).
//!
//! Bundled into the desktop installer via Tauri `externalBin`.
//! The app does **not** spawn this process on the default path yet (#166).
//! Out-of-band Node host smokes remain `packages/service` CLI until cutover.

fn usage() -> ! {
    eprintln!(
        "Usage:\n  collector-service --version\n  collector-service serve --data-dir <path> [options]\n\n\
         This binary is an internal app sidecar (not a user-facing daemon).\n\
         Default Collector runs still use the in-process index path.\n\
         Spawning from the app is wired in a later epic child (#166)."
    );
    std::process::exit(2);
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        usage();
    };

    match command.as_str() {
        "--version" | "-V" | "version" => {
            println!("collector-service {}", env!("CARGO_PKG_VERSION"));
        }
        "serve" => {
            // Fail fast: packaging only in #165. Runtime supervise/spawn is #166.
            eprintln!(
                "collector-service: serve is not activated in the packaged sidecar yet (see #166).\n\
                 For out-of-band host development use the Node CLI (`@collector/service`)."
            );
            std::process::exit(2);
        }
        "--help" | "-h" | "help" => usage(),
        other => {
            eprintln!("unknown command: {other}");
            usage();
        }
    }
}
