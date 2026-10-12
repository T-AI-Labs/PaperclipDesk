fn main() {
    // The server version the app runs is pinned in the root package.json; a release build also gets the package's checksum.
    let manifest = std::fs::read_to_string("../../package.json").expect("root package.json");
    let manifest: serde_json::Value = serde_json::from_str(&manifest).expect("root package.json is JSON");
    println!("cargo:rustc-env=PAPERCLIP_SERVER_VERSION={}", manifest["paperclip"]["server"].as_str().expect("paperclip.server in package.json"));
    println!("cargo:rerun-if-changed=../../package.json");
    println!("cargo:rerun-if-env-changed=PAPERCLIP_SERVER_SHA256");
    if let Ok(sha256) = std::env::var("PAPERCLIP_SERVER_SHA256") {
        println!("cargo:rustc-env=PAPERCLIP_SERVER_SHA256={sha256}");
    }

    // Declaring the commands makes them deny-by-default; capabilities/default.json allows them explicitly.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "launcher_state",
        "set_chooser_mode",
        "set_always_show_chooser",
        "remember_local",
        "set_startup_profile",
        "save_remote_profile",
        "duplicate_profile",
        "delete_profile",
        "verify_remote",
        "cancel_connect",
        "connect_local",
        "connect_remote",
        "connect_saved_profile",
        "return_to_current_session",
        "get_settings",
        "update_settings",
        "get_log",
        "clear_log",
        "open_data_folder",
        "get_about",
        "show_page",
        "server_info",
        "restart_local_server",
        "reinstall_server",
        "read_server_config",
        "write_server_config",
        "reset_local_server",
        "export_settings",
        "import_settings",
        "check_for_updates",
        "install_update",
    ])))
    .expect("tauri build script");
}
