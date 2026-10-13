use crate::i18n;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::client::{Client, LauncherPage, LauncherView};
use crate::connection::types::LOCAL_PROFILE_ID;

const RECENT_PREFIX: &str = "connection.recent.";
const OPEN_PREFIX: &str = "connection.open.";
const ZOOM_PREFIX: &str = "view.zoom.";
const ZOOM_LEVELS: [u32; 9] = [50, 75, 90, 100, 110, 125, 150, 175, 200];
pub const RECENT_CONNECTIONS: usize = 5;
const ZOOM_STEP: f64 = 0.1;
const DOCS_URL: &str = "https://docs.paperclip.ing/";
const REPOSITORY_URL: &str = "https://github.com/T-AI-Labs/PaperclipDesk";
/// Written by `npm run licenses` and shipped as a resource next to the app.
const LICENSES_FILE: &str = "THIRD_PARTY_LICENSES.txt";

/// The project's own pages. They are fixed here, so the window never hands the app a URL to open.
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLink {
    Repository,
    ReportIssue,
}

/// Opens the page in the browser; a new issue starts with the versions it is about.
pub fn open_project_link(client: &Client, link: ProjectLink) -> Result<(), String> {
    let url = match link {
        ProjectLink::Repository => REPOSITORY_URL.to_owned(),
        ProjectLink::ReportIssue => {
            let versions = format!("\n\n---\nPaperclipDesk {}, Paperclip server {}", env!("CARGO_PKG_VERSION"), client.local_server_version().as_deref().unwrap_or("–"));
            tauri::Url::parse_with_params(&format!("{REPOSITORY_URL}/issues/new"), [("body", versions)]).map_err(|e| e.to_string())?.into()
        }
    };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// One entry of a menu as the shell draws it; `handle` gets the id of the one the user picked.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Entry {
    Item { id: String, label: String, enabled: bool, checked: Option<bool> },
    Separator,
    Submenu { label: String, enabled: bool, entries: Vec<Entry> },
}

#[derive(Serialize, Clone, Debug)]
pub struct Menu {
    label: String,
    entries: Vec<Entry>,
}

fn item(id: &str, label: &str) -> Entry {
    Entry::Item { id: id.to_owned(), label: label.to_owned(), enabled: true, checked: None }
}

fn check(id: String, label: String, checked: bool) -> Entry {
    Entry::Item { id, label, enabled: true, checked: Some(checked) }
}

/// The menu bar of the window. The shell draws it; it is part of every snapshot, so it follows the saved connections and the ones in use.
pub fn build(client: &Client) -> Vec<Menu> {
    let recent = client.store.lock().unwrap().recent_remote_profiles(RECENT_CONNECTIONS);
    let open = client.open_profile_ids();
    // Paperclip's own zoom exists only while a connection is open.
    let connected = client.paperclip_webview().is_some();
    let server_version = client.local_server_version();

    let app = vec![item("settings.open", i18n::t("Einstellungen …")), item("app.updates", i18n::t("Nach Updates suchen …")), Entry::Separator, item("app.quit", i18n::t("Beenden"))];

    // The places to connect to first, the open ones ticked: an entry opens its connection or brings it to the front. Choosing and editing below.
    let connected_to = |profile_id: &str| open.iter().any(|id| id == profile_id);
    let mut connection = vec![check("connection.local".into(), i18n::t("Lokal").into(), connected_to(LOCAL_PROFILE_ID))];
    for profile in &recent {
        let host = profile.remote_url.as_deref().and_then(|url| tauri::Url::parse(url).ok()).and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_default();
        connection.push(check(format!("{RECENT_PREFIX}{}", profile.id), i18n::f("{} (Remote: {})", &[&profile.name, &host]), connected_to(&profile.id)));
    }
    connection.extend(client.open_unsaved_connections().into_iter().map(|(key, name)| check(format!("{OPEN_PREFIX}{key}"), name, true)));
    connection.extend([Entry::Separator, item("connection.chooser", i18n::t("Alle Verbindungen …")), item("connection.manage", i18n::t("Remotes bearbeiten …"))]);

    let zoom_percent = client.zoom_percent();
    let mut zoom = vec![item("view.zoom_in", i18n::t("Vergrößern")), item("view.zoom_out", i18n::t("Verkleinern")), item("view.zoom_reset", i18n::t("Zoom zurücksetzen")), Entry::Separator];
    zoom.extend(ZOOM_LEVELS.map(|percent| check(format!("{ZOOM_PREFIX}{percent}"), format!("{percent} %"), percent == zoom_percent)));
    let view = vec![item("view.reload", i18n::t("Neu laden")), Entry::Separator, Entry::Submenu { label: "Zoom".into(), enabled: connected, entries: zoom }, item("view.fullscreen", i18n::t("Vollbild"))];

    // Reading first, then everything for looking into a problem.
    let help = vec![
        item("help.docs", i18n::t("Paperclip-Dokumentation")),
        item("help.repository", i18n::t("Projekt auf GitHub")),
        item("help.report_issue", i18n::t("Problem melden …")),
        item("help.licenses", i18n::t("Lizenzen Dritter")),
        Entry::Separator,
        item("help.logs", i18n::t("Protokoll")),
        item("help.data_folder", i18n::t("Datenordner öffnen")),
        item("view.devtools", i18n::t("Entwicklertools")),
        Entry::Separator,
        Entry::Item { id: "help.version".into(), label: format!("Paperclip {}", server_version.as_deref().unwrap_or("–")), enabled: false, checked: None },
        item("help.about", i18n::t("Über PaperclipDesk")),
    ];

    [("PaperclipDesk", app), (i18n::t("Verbinden"), connection), (i18n::t("Ansicht"), view), (i18n::t("Hilfe"), help)].into_iter().map(|(label, entries)| Menu { label: label.to_owned(), entries }).collect()
}

/// Windows draws the menu of the title bar itself and follows its own app mode; this makes it follow the app's colour scheme.
pub fn apply_color_scheme(theme: Option<tauri::Theme>) {
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    // uxtheme exports both by ordinal only: SetPreferredAppMode (135; 1 follows Windows, 2 forces dark, 3 forces light) and FlushMenuThemes (136).
    let mode: i32 = match theme {
        Some(tauri::Theme::Dark) => 2,
        Some(tauri::Theme::Light) => 3,
        _ => 1,
    };
    unsafe {
        let uxtheme = LoadLibraryW(windows_sys::w!("uxtheme.dll"));
        if uxtheme.is_null() {
            return;
        }
        if let (Some(set_preferred_app_mode), Some(flush_menu_themes)) = (GetProcAddress(uxtheme, 135 as _), GetProcAddress(uxtheme, 136 as _)) {
            let set_preferred_app_mode: unsafe extern "system" fn(i32) -> i32 = std::mem::transmute(set_preferred_app_mode);
            let flush_menu_themes: unsafe extern "system" fn() = std::mem::transmute(flush_menu_themes);
            set_preferred_app_mode(mode);
            flush_menu_themes();
        }
    }
}

/// Runs off the main thread: several entries open windows or wait for a connection.
pub fn handle(client: &Arc<Client>, id: &str) {
    let (client, id) = (Arc::clone(client), id.to_owned());
    std::thread::spawn(move || match id.as_str() {
        "app.updates" => client.show_page(LauncherPage::System),
        "app.quit" => client.handle().exit(0),
        "connection.chooser" => client.show_launcher(LauncherView::Chooser, None, None),
        "connection.local" => client.boot_local(false),
        "connection.manage" => client.show_page(LauncherPage::Connections),
        "settings.open" => client.show_page(LauncherPage::System),
        "view.zoom_reset" => client.change_zoom(None),
        "view.zoom_in" => client.change_zoom(Some(ZOOM_STEP)),
        "view.zoom_out" => client.change_zoom(Some(-ZOOM_STEP)),
        "help.licenses" => {
            let opened = client.handle().path().resource_dir().map_err(|e| e.to_string()).and_then(|dir| tauri_plugin_opener::open_path(dir.join(LICENSES_FILE), None::<&str>).map_err(|e| e.to_string()));
            if let Err(e) = opened {
                tracing::warn!("opening the third-party licenses: {e}");
            }
        }
        "help.logs" => client.show_page(LauncherPage::Logs),
        "help.data_folder" => {
            if let Err(e) = tauri_plugin_opener::open_path(&client.paths.user_data, None::<&str>) {
                tracing::warn!("opening the data folder: {e}");
            }
        }
        "help.repository" | "help.report_issue" => {
            let link = if id == "help.repository" { ProjectLink::Repository } else { ProjectLink::ReportIssue };
            if let Err(e) = open_project_link(&client, link) {
                tracing::warn!("opening a project page: {e}");
            }
        }
        "help.about" => {
            let description = i18n::t("PaperclipDesk macht Paperclip zu einem Windows-Programm: Es startet den Server samt Datenbank selbst oder verbindet sich mit einem Remote – ohne Terminal und ohne Browser-Tab. Open Source unter der MIT-Lizenz, ohne Telemetrie.");
            let versions = i18n::f("PaperclipDesk {}\nPaperclip-Server: {}\n\nDaten: {}", &[&env!("CARGO_PKG_VERSION"), &client.local_server_version().as_deref().unwrap_or("–"), &client.paths.user_data.display()]);
            let dialog = client.handle().dialog().message(format!("{description}\n\n{versions}\n\n{REPOSITORY_URL}")).title(i18n::t("Über PaperclipDesk")).kind(MessageDialogKind::Info);
            match client.window() {
                Some(window) => dialog.parent(&window).blocking_show(),
                None => dialog.blocking_show(),
            };
        }
        "help.docs" => {
            if let Err(e) = tauri_plugin_opener::open_url(DOCS_URL, None::<&str>) {
                tracing::warn!("opening the documentation: {e}");
            }
        }
        other => {
            if let Some(percent) = other.strip_prefix(ZOOM_PREFIX).and_then(|percent| percent.parse::<u32>().ok()) {
                client.set_zoom(f64::from(percent) / 100.0);
            } else if let Some(profile_id) = other.strip_prefix(RECENT_PREFIX) {
                client.boot_saved_profile(profile_id);
            } else if let Some(key) = other.strip_prefix(OPEN_PREFIX) {
                client.activate_connection(key);
            } else if let Some(window) = client.window() {
                let webview = client.active_webview();
                let done = match other {
                    "view.reload" => webview.map_or(Ok(()), |webview| webview.reload()),
                    "view.fullscreen" => window.is_fullscreen().and_then(|fullscreen| window.set_fullscreen(!fullscreen)),
                    "view.devtools" => {
                        if let Some(webview) = webview {
                            if webview.is_devtools_open() { webview.close_devtools() } else { webview.open_devtools() }
                        }
                        Ok(())
                    }
                    _ => Ok(()),
                };
                if let Err(e) = done {
                    tracing::warn!("menu entry {other}: {e}");
                }
            }
        }
    });
}
