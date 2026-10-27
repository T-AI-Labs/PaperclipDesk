#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod client;
mod companies;
mod connection;
mod i18n;
mod instance;
mod logs;
mod menu;
mod paths;
mod server;
mod server_package;
mod settings;
mod shortcuts;
mod tray;
mod updater;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

use crate::client::{Client, RemoteConnect, Snapshot};
use crate::connection::http::UreqFetch;
use crate::connection::preflight::preflight_remote_connection;
use crate::connection::profiles::{RemoteProfileInput, now_iso};
use crate::connection::types::RemotePreflightResult;
use crate::instance::ConfigFile;
use crate::logs::LogTail;
use crate::paths::{DataEnv, DataPaths};
use crate::settings::Settings;

type Shared<'a> = State<'a, Arc<Client>>;

fn init_logging(log_dir: &Path) -> anyhow::Result<WorkerGuard> {
    std::fs::create_dir_all(log_dir)?;
    let file = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("paperclipdesk")
        .filename_suffix("log")
        .max_log_files(7)
        .build(log_dir)?;
    let (file_writer, guard) = tracing_appender::non_blocking(file);
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let stderr = cfg!(debug_assertions).then(|| tracing_subscriber::fmt::layer().with_writer(std::io::stderr));
    tracing_subscriber::registry().with(filter).with(tracing_subscriber::fmt::layer().with_ansi(false).with_writer(file_writer)).with(stderr).init();
    Ok(guard)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteProfilePayload {
    profile_id: Option<String>,
    name: Option<String>,
    remote_url: String,
    #[serde(default)]
    allow_insecure_http: bool,
}

#[derive(Serialize)]
struct About {
    version: &'static str,
    server_version: Option<String>,
    user_data: String,
    paperclip_home: String,
}

#[tauri::command]
async fn launcher_state(client: Shared<'_>) -> Result<Snapshot, String> {
    Ok(client.snapshot())
}

/// Whether the connection is opened on every launch without asking.
#[tauri::command]
async fn set_open_at_start(client: Shared<'_>, profile_id: String, open: bool) -> Result<Snapshot, String> {
    client.store.lock().unwrap().set_open_at_start(&profile_id, open);
    client.send_state();
    Ok(client.snapshot())
}

#[tauri::command]
async fn activate_connection(client: Shared<'_>, key: String) -> Result<(), String> {
    client.activate_connection(&key);
    Ok(())
}

#[tauri::command]
async fn close_connection(client: Shared<'_>, key: String) -> Result<(), String> {
    client.close_connection(&key);
    Ok(())
}

/// The user picked an entry of the menu bar.
#[tauri::command]
async fn menu_action(client: Shared<'_>, id: String) -> Result<(), String> {
    menu::handle(&client, &id);
    Ok(())
}

#[tauri::command]
async fn import_company_template(client: Shared<'_>, source: companies::TemplateSource, name: Option<String>, secrets: HashMap<String, String>, adapters: HashMap<String, companies::AdapterOverride>) -> Result<(), String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.import_template(&source, name.as_deref(), &secrets, &adapters)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn adapter_options(client: Shared<'_>) -> Result<Vec<companies::AdapterOption>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.adapter_options()).await.map_err(|e| e.to_string())?
}

/// The inbox of the company in front for the bell; `None` while no company is open.
#[tauri::command]
async fn company_attention(client: Shared<'_>) -> Result<Option<companies::Attention>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.attention()).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_paperclip_path(client: Shared<'_>, path: String) -> Result<(), String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.open_paperclip_path(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn record_shortcut(client: Shared<'_>, recording: bool) -> Result<(), String> {
    client.record_shortcut(recording);
    Ok(())
}

#[tauri::command]
async fn set_menu_open(client: Shared<'_>, open: bool) -> Result<(), String> {
    client.set_menu_open(open);
    Ok(())
}

#[tauri::command]
async fn save_remote_profile(client: Shared<'_>, payload: RemoteProfilePayload) -> Result<Snapshot, String> {
    let input = RemoteProfileInput { profile_id: payload.profile_id, name: payload.name, remote_url: payload.remote_url, allow_insecure_http: payload.allow_insecure_http };
    client.store.lock().unwrap().save_remote_profile(input, &now_iso())?;
    client.send_state();
    Ok(client.snapshot())
}

#[tauri::command]
async fn duplicate_profile(client: Shared<'_>, profile_id: String) -> Result<Snapshot, String> {
    client.store.lock().unwrap().duplicate_remote_profile(&profile_id, &now_iso())?;
    client.send_state();
    Ok(client.snapshot())
}

#[tauri::command]
async fn delete_profile(client: Shared<'_>, profile_id: String) -> Result<Snapshot, String> {
    client.delete_profile(&profile_id);
    Ok(client.snapshot())
}

#[tauri::command]
async fn verify_remote(client: Shared<'_>, remote_url: String) -> Result<RemotePreflightResult, String> {
    let local_version = client.local_server_version();
    tauri::async_runtime::spawn_blocking(move || preflight_remote_connection(&remote_url, local_version.as_deref(), &UreqFetch::default())).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_connect(client: Shared<'_>) -> Result<(), String> {
    client.cancel_boot();
    Ok(())
}

#[tauri::command]
async fn connect_local(client: Shared<'_>) -> Result<(), String> {
    let client = Arc::clone(&client);
    std::thread::spawn(move || client.boot_local(false));
    Ok(())
}

#[tauri::command]
async fn connect_remote(client: Shared<'_>, payload: RemoteConnect) -> Result<(), String> {
    let client = Arc::clone(&client);
    std::thread::spawn(move || client.boot_remote(payload));
    Ok(())
}

#[tauri::command]
async fn connect_saved_profile(client: Shared<'_>, profile_id: String) -> Result<(), String> {
    let client = Arc::clone(&client);
    std::thread::spawn(move || client.boot_saved_profile(&profile_id));
    Ok(())
}

#[tauri::command]
async fn return_to_current_session(client: Shared<'_>) -> Result<bool, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.return_to_current_session()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_settings(client: Shared<'_>) -> Result<Settings, String> {
    Ok(client.settings.lock().unwrap().clone())
}

#[tauri::command]
async fn update_settings(client: Shared<'_>, mut settings: Settings) -> Result<Settings, String> {
    // Only an upgrade changes the server version, after the user confirmed it.
    settings.server_version = client.settings.lock().unwrap().server_version.clone();
    settings::save(&settings::file_path(&client.paths.user_data), &settings).map_err(|e| i18n::f("Einstellungen ließen sich nicht speichern: {}", &[&e]))?;
    let scheme_changed = client.settings.lock().unwrap().color_scheme != settings.color_scheme;
    *client.settings.lock().unwrap() = settings.clone();
    if scheme_changed {
        client.reset_paperclip_theme();
    }
    // The menu bar and the tray are in the app's language too.
    i18n::set(&settings.language);
    tray::sync(client.handle(), settings.show_tray);
    client.apply_color_scheme();
    client.relayout();
    client.send_state();
    Ok(settings)
}

#[tauri::command]
async fn get_log(client: Shared<'_>, file: Option<String>, lines: usize) -> Result<LogTail, String> {
    logs::log_tail(&client.paths, file, lines)
}

#[tauri::command]
async fn clear_log(client: Shared<'_>, file: String) -> Result<(), String> {
    logs::clear(&client.paths, &file)
}

#[tauri::command]
async fn open_data_folder(client: Shared<'_>) -> Result<(), String> {
    tauri_plugin_opener::open_path(&client.paths.user_data, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_project_link(client: Shared<'_>, link: menu::ProjectLink) -> Result<(), String> {
    menu::open_project_link(&client, link)
}

#[tauri::command]
async fn show_page(client: Shared<'_>, page: client::LauncherPage) -> Result<(), String> {
    client.show_page(page);
    Ok(())
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<updater::UpdateOffer, String> {
    updater::check(&app).await
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    updater::install(&app).await
}

/// What the settings show about the server of this machine.
#[derive(Serialize)]
struct ServerInfo {
    version: Option<String>,
    /// The version this build of the app runs.
    pinned_version: &'static str,
    can_reinstall: bool,
    running: bool,
    instance_dir: String,
}

#[derive(Serialize)]
struct ServerConfig {
    config: String,
    env: String,
}

#[tauri::command]
async fn server_info(client: Shared<'_>) -> Result<ServerInfo, String> {
    Ok(ServerInfo {
        version: client.local_server_version(),
        pinned_version: server_package::VERSION,
        can_reinstall: client.can_reinstall_server(),
        running: client.local_connected(),
        instance_dir: instance::instance_dir(&client.paths.paperclip_home).display().to_string(),
    })
}

#[tauri::command]
async fn restart_local_server(client: Shared<'_>) -> Result<(), String> {
    let client = Arc::clone(&client);
    std::thread::spawn(move || client.boot_local(true));
    Ok(())
}

#[tauri::command]
async fn reinstall_server(client: Shared<'_>) -> Result<(), String> {
    let client = Arc::clone(&client);
    std::thread::spawn(move || client.reinstall_server());
    Ok(())
}

/// The server versions newer than the local one, newest first, from the signed list.
#[tauri::command]
async fn server_versions(client: Shared<'_>) -> Result<Vec<String>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.newer_server_versions()).await.map_err(|e| e.to_string())?
}

/// Installs a newer server version and starts it; resolves to where the data was copied when a backup was asked for.
#[tauri::command]
async fn upgrade_server(client: Shared<'_>, version: String, backup: bool) -> Result<Option<String>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || client.upgrade_server(&version, backup).map(|copy| copy.map(|path| path.display().to_string()))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_server_config(client: Shared<'_>) -> Result<ServerConfig, String> {
    let instance = instance::instance_dir(&client.paths.paperclip_home);
    Ok(ServerConfig { config: instance::read_config(&instance, ConfigFile::Config), env: instance::read_config(&instance, ConfigFile::Env) })
}

#[tauri::command]
async fn write_server_config(client: Shared<'_>, file: ConfigFile, content: String) -> Result<(), String> {
    instance::write_config(&instance::instance_dir(&client.paths.paperclip_home), file, &content)
}

/// Stops the local server and empties its data; returns where the old data went when a backup was asked for.
#[tauri::command]
async fn reset_local_server(client: Shared<'_>, keep_config: bool, backup: bool) -> Result<Option<String>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || {
        client.stop_local();
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let moved = instance::reset(&instance::instance_dir(&client.paths.paperclip_home), keep_config, backup, &stamp)?;
        Ok(moved.map(|path| path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The app's settings and saved remotes as one file, to carry them to another machine.
#[derive(Serialize, Deserialize)]
struct SettingsExport {
    app: String,
    version: String,
    settings: Settings,
    #[serde(default)]
    remotes: Vec<ExportedRemote>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedRemote {
    name: String,
    remote_url: String,
    #[serde(default)]
    allow_insecure_http: bool,
}

const EXPORT_APP: &str = "PaperclipDesk";
const EXPORT_FILE_NAME: &str = "paperclipdesk-settings.json";

/// Asks where to save and writes the settings there; `None` when the user cancelled.
#[tauri::command]
async fn export_settings(client: Shared<'_>) -> Result<Option<String>, String> {
    let export = SettingsExport {
        app: EXPORT_APP.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        settings: client.settings.lock().unwrap().clone(),
        remotes: remote_profiles(&client).into_iter().map(|(name, remote_url, allow_insecure_http)| ExportedRemote { name, remote_url, allow_insecure_http }).collect(),
    };
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(target) = file_dialog(&client).set_file_name(EXPORT_FILE_NAME).blocking_save_file() else { return Ok(None) };
        let path = target.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, serde_json::to_string_pretty(&export).expect("settings serialize")).map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Asks for an exported file, takes over its settings and adds the remotes that are not saved yet; `None` when the user cancelled.
#[tauri::command]
async fn import_settings(client: Shared<'_>) -> Result<Option<Settings>, String> {
    let client = Arc::clone(&client);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(source) = file_dialog(&client).blocking_pick_file() else { return Ok(None) };
        let path = source.into_path().map_err(|e| e.to_string())?;
        let raw = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut import: SettingsExport = serde_json::from_str(&raw).map_err(|_| i18n::t("Diese Datei enthält keine PaperclipDesk-Einstellungen.").to_owned())?;
        // Another machine's server version would migrate this machine's data without asking.
        import.settings.server_version = client.settings.lock().unwrap().server_version.clone();

        settings::save(&settings::file_path(&client.paths.user_data), &import.settings).map_err(|e| i18n::f("Einstellungen ließen sich nicht speichern: {}", &[&e]))?;
        *client.settings.lock().unwrap() = import.settings.clone();
        i18n::set(&import.settings.language);
        tray::sync(client.handle(), import.settings.show_tray);
        client.apply_color_scheme();

        let known: Vec<String> = remote_profiles(&client).into_iter().map(|(_, remote_url, _)| remote_url).collect();
        {
            let mut store = client.store.lock().unwrap();
            for remote in import.remotes.into_iter().filter(|remote| !known.contains(&remote.remote_url)) {
                let input = RemoteProfileInput { profile_id: None, name: Some(remote.name), remote_url: remote.remote_url, allow_insecure_http: remote.allow_insecure_http };
                if let Err(e) = store.save_remote_profile(input, &now_iso()) {
                    tracing::warn!("importing a remote: {e}");
                }
            }
        }
        client.send_state();
        Ok(Some(import.settings))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn remote_profiles(client: &Client) -> Vec<(String, String, bool)> {
    let profiles = client.store.lock().unwrap().list_profiles();
    profiles.into_iter().filter_map(|profile| profile.remote_url.map(|url| (profile.name, url, profile.allow_insecure_http == Some(true)))).collect()
}

fn file_dialog(client: &Client) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let dialog = client.handle().dialog().file().add_filter("JSON", &["json"]);
    match client.window() {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

#[tauri::command]
async fn get_about(client: Shared<'_>) -> Result<About, String> {
    Ok(About {
        version: env!("CARGO_PKG_VERSION"),
        server_version: client.local_server_version(),
        user_data: client.paths.user_data.display().to_string(),
        paperclip_home: client.paths.paperclip_home.display().to_string(),
    })
}

fn main() -> anyhow::Result<()> {
    let env = DataEnv::from_process();
    let paths = DataPaths::resolve(&env)?;
    let _log_guard = init_logging(&paths.log_dir())?;
    tracing::info!(version = env!("CARGO_PKG_VERSION"), user_data = %paths.user_data.display(), paperclip_home = %paths.paperclip_home.display(), "starting");

    let builder = tauri::Builder::default();
    // A test run with its own data folder must not hand its start to the installed app, nor a second
    // instance start a second server on the same database.
    let builder = if env.user_data_dir.is_none() {
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let client = Arc::clone(&app.state::<Arc<Client>>());
            std::thread::spawn(move || client.focus_existing());
        }))
    } else {
        builder
    };
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default())
        .setup(move |app| {
            let client = Client::new(app.handle().clone(), paths);
            app.manage(Arc::clone(&client));
            client.start();
            tray::sync(app.handle(), client.settings.lock().unwrap().show_tray);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Resized(_)) {
                window.state::<Arc<Client>>().relayout();
            }
        })
        .invoke_handler(tauri::generate_handler![
            launcher_state,
            set_open_at_start,
            activate_connection,
            close_connection,
            menu_action,
            set_menu_open,
            record_shortcut,
            import_company_template,
            company_attention,
            adapter_options,
            open_paperclip_path,
            save_remote_profile,
            duplicate_profile,
            delete_profile,
            verify_remote,
            cancel_connect,
            connect_local,
            connect_remote,
            connect_saved_profile,
            return_to_current_session,
            get_settings,
            update_settings,
            get_log,
            clear_log,
            open_data_folder,
            open_project_link,
            get_about,
            show_page,
            server_info,
            restart_local_server,
            reinstall_server,
            server_versions,
            upgrade_server,
            read_server_config,
            write_server_config,
            reset_local_server,
            export_settings,
            import_settings,
            check_for_updates,
            install_update
        ])
        .build(tauri::generate_context!())?;

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit) {
            app.state::<Arc<Client>>().shutdown();
        }
    });
    Ok(())
}
