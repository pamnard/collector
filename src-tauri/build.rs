fn main() {
    if std::env::var("DEP_TAURI_DEV").as_deref() == Ok("true") {
        std::env::set_var(
            "TAURI_CONFIG",
            r#"{"identifier":"com.collector.app.dev","productName":"Collector Dev","app":{"windows":[{"title":"Collector Dev"}]}}"#,
        );
    }

    tauri_build::build();
}
