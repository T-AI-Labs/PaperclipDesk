use crate::i18n;
use std::sync::Arc;

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Manager, Wry};

use crate::client::{Client, LauncherPage, LauncherView};
use crate::connection::types::LOCAL_PROFILE_ID;

const RECENT_PREFIX: &str = "connection.recent.";
const ZOOM_PREFIX: &str = "view.zoom.";
const ZOOM_LEVELS: [u32; 9] = [50, 75, 90, 100, 110, 125, 150, 175, 200];
pub const RECENT_CONNECTIONS: usize = 5;
const ZOOM_STEP: f64 = 0.1;
const DOCS_URL: &str = "https://docs.paperclip.ing/";
/// Written by `npm run licenses` and shipped as a resource next to the app.
const LICENSES_FILE: &str = "THIRD_PARTY_LICENSES.txt";

/// The menu bar of the Paperclip window; rebuilt whenever the saved connections or the one in use change.
pub fn build(client: &Client) -> tauri::Result<Menu<Wry>> {
    let handle = client.handle();
    let recent = client.store.lock().unwrap().recent_remote_profiles(RECENT_CONNECTIONS);
    let current = client.current_profile_id();
    // Paperclip's own view and its zoom exist only while a connection is open.
    let connected = client.paperclip_webview().is_some();
    let server_version = client.local_server_version();
    let entry = |id: &str, text: &str, enabled: bool| MenuItemBuilder::with_id(id, text).enabled(enabled).build(handle);

    let app = SubmenuBuilder::new(handle, "PaperclipDesk")
        .text("settings.open", i18n::t("Einstellungen …"))
        .text("app.updates", i18n::t("Nach Updates suchen …"))
        .separator()
        .text("app.quit", i18n::t("Beenden"))
        .build()?;

    // The places to connect to first, the one in use ticked; choosing and editing below.
    let connected_to = |profile_id: &str| current.as_deref() == Some(profile_id);
    let local = CheckMenuItemBuilder::with_id("connection.local", i18n::t("Dieser Computer")).checked(connected_to(LOCAL_PROFILE_ID)).build(handle)?;
    let mut connection = SubmenuBuilder::new(handle, i18n::t("Verbinden")).item(&local);
    for profile in &recent {
        let host = profile.remote_url.as_deref().and_then(|url| tauri::Url::parse(url).ok()).and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_default();
        let remote = CheckMenuItemBuilder::with_id(format!("{RECENT_PREFIX}{}", profile.id), i18n::f("{} (Remote: {})", &[&profile.name, &host])).checked(connected_to(&profile.id)).build(handle)?;
        connection = connection.item(&remote);
    }
    let connection = connection.separator().text("connection.chooser", i18n::t("Alle Verbindungen …")).text("connection.manage", i18n::t("Remotes bearbeiten …")).build()?;

    let zoom_percent = client.zoom_percent();
    let mut zoom = SubmenuBuilder::new(handle, "Zoom")
        .enabled(connected)
        .text("view.zoom_in", i18n::t("Vergrößern"))
        .text("view.zoom_out", i18n::t("Verkleinern"))
        .text("view.zoom_reset", i18n::t("Zoom zurücksetzen"))
        .separator();
    for percent in ZOOM_LEVELS {
        zoom = zoom.item(&CheckMenuItemBuilder::with_id(format!("{ZOOM_PREFIX}{percent}"), format!("{percent} %")).checked(percent == zoom_percent).build(handle)?);
    }
    let view = SubmenuBuilder::new(handle, i18n::t("Ansicht"))
        .item(&entry("view.paperclip", "Paperclip", connected)?)
        .separator()
        .text("view.reload", i18n::t("Neu laden"))
        .separator()
        .item(&zoom.build()?)
        .text("view.fullscreen", i18n::t("Vollbild"))
        .build()?;

    // Reading first, then everything for looking into a problem.
    let help = SubmenuBuilder::new(handle, i18n::t("Hilfe"))
        .text("help.docs", i18n::t("Dokumentation"))
        .text("help.licenses", i18n::t("Lizenzen Dritter"))
        .separator()
        .text("help.logs", i18n::t("Protokoll"))
        .text("help.data_folder", i18n::t("Datenordner öffnen"))
        .text("view.devtools", i18n::t("Entwicklertools"))
        .separator()
        .item(&entry("help.version", &format!("Paperclip {}", server_version.as_deref().unwrap_or("–")), false)?)
        .build()?;

    MenuBuilder::new(handle).items(&[&app, &connection, &view, &help]).build()
}

/// Windows draws the dropdowns itself and follows its own app mode; this makes them follow the app's colour scheme, as the bar does.
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
        "connection.local" => {
            client.invalidate_menu();
            client.boot_local(None, false);
        }
        "connection.manage" => client.show_launcher(LauncherView::Saved, None, None),
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
        "help.docs" => {
            if let Err(e) = tauri_plugin_opener::open_url(DOCS_URL, None::<&str>) {
                tracing::warn!("opening the documentation: {e}");
            }
        }
        other => {
            if let Some(percent) = other.strip_prefix(ZOOM_PREFIX).and_then(|percent| percent.parse::<u32>().ok()) {
                client.invalidate_menu();
                client.set_zoom(f64::from(percent) / 100.0);
            } else if let Some(profile_id) = other.strip_prefix(RECENT_PREFIX) {
                client.invalidate_menu();
                client.boot_saved_profile(profile_id, None);
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
