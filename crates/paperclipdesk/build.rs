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
    // The list of newer server versions has a signing key of its own: one stolen from that workflow cannot sign app updates.
    let catalog_key = std::fs::read_to_string("server-catalog.pub").expect("server-catalog.pub");
    println!("cargo:rustc-env=PAPERCLIPDESK_SERVER_CATALOG_PUBKEY={}", catalog_key.trim());
    println!("cargo:rerun-if-changed=server-catalog.pub");

    // Declaring the commands makes them deny-by-default; capabilities/default.json allows them explicitly.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "launcher_state",
        "set_open_at_start",
        "activate_connection",
        "close_connection",
        "menu_action",
        "set_menu_open",
        "record_shortcut",
        "import_company_template",
        "company_attention",
        "adapter_options",
        "open_paperclip_path",
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
        "open_project_link",
        "get_about",
        "show_page",
        "server_info",
        "restart_local_server",
        "reinstall_server",
        "server_versions",
        "upgrade_server",
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
