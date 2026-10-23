use crate::i18n;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

use crate::client::{Client, LauncherPage, LauncherView};
use crate::companies;
use crate::connection::types::LOCAL_PROFILE_ID;

const RECENT_PREFIX: &str = "connection.recent.";
const OPEN_PREFIX: &str = "connection.open.";
const PAGE_PREFIX: &str = "paperclip.page.";
const COMPANY_PREFIX: &str = "company.";
/// Entries with these ids open a panel of the shell; the shell handles them itself and never hands them to `handle`.
const SHELL_UPDATES: &str = "shell.updates";
const SHELL_CONNECTIONS: &str = "shell.connections";
const SHELL_TEMPLATES: &str = "shell.templates";
pub const RECENT_CONNECTIONS: usize = 5;
const ZOOM_STEP: f64 = 0.1;
const DOCS_URL: &str = "https://docs.paperclip.ing/";
const REPOSITORY_URL: &str = "https://github.com/T-AI-Labs/PaperclipDesk";
/// Written by `npm run licenses` and shipped as a resource next to the app.
const LICENSES_FILE: &str = "THIRD_PARTY_LICENSES.txt";

/// The project's own pages and the template sites the shell points to. They are built here, so the window never hands the app a URL to open.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLink {
    Repository,
    ReportIssue,
    Clipmart,
    PaperclipCloud,
    UsePaperclip,
    /// Where the user makes a token for the template search.
    GithubTokens,
    /// A template's folder in Paperclip's catalog.
    Template(String),
    /// The GitHub repository a template was generated from, as owner/name.
    TemplateSource(String),
}

/// A GitHub repository as owner/name, with nothing in it that leaves the repository's page.
fn github_repository(repository: &str) -> Result<String, String> {
    let part = |part: &str| !part.is_empty() && !part.starts_with('.') && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    match repository.split_once('/') {
        Some((owner, name)) if part(owner) && part(name) => Ok(format!("https://github.com/{owner}/{name}")),
        _ => Err(i18n::t("Diese Vorlage gibt es nicht.").to_owned()),
    }
}

/// Opens the page in the browser; a new issue starts with the versions it is about.
pub fn open_project_link(client: &Client, link: ProjectLink) -> Result<(), String> {
    let url = match link {
        ProjectLink::Repository => REPOSITORY_URL.to_owned(),
        ProjectLink::ReportIssue => {
            let versions = format!("\n\n---\nPaperclipDesk {}, Paperclip server {}", env!("CARGO_PKG_VERSION"), client.local_server_version().as_deref().unwrap_or("–"));
            tauri::Url::parse_with_params(&format!("{REPOSITORY_URL}/issues/new"), [("body", versions)]).map_err(|e| e.to_string())?.into()
        }
        ProjectLink::Clipmart => "https://www.clipmart.ai/".to_owned(),
        ProjectLink::PaperclipCloud => "https://paperclipcloud.com/companies".to_owned(),
        ProjectLink::UsePaperclip => "https://usepaperclip.app/".to_owned(),
        ProjectLink::GithubTokens => "https://github.com/settings/personal-access-tokens/new".to_owned(),
        ProjectLink::Template(template) => companies::template_url(&template)?,
        ProjectLink::TemplateSource(repository) => github_repository(&repository)?,
    };
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// One entry of a menu as the shell draws it; `handle` gets the id of the one the user picked.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Entry {
    Item { id: String, label: String, enabled: bool, checked: Option<bool> },
    Separator,
    /// A heading above the entries that follow it.
    Label { label: String },
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

fn label(label: &str) -> Entry {
    Entry::Label { label: label.to_owned() }
}

/// The menus at the left of the menu bar, all about the Paperclip in front. The shell draws them; they are part of every snapshot.
pub fn build(client: &Client) -> Vec<Menu> {
    // Paperclip's pages exist only while a connection is open.
    let connected = client.paperclip_webview().is_some();
    let action = |id: String, label: &str| Entry::Item { id, label: label.to_owned(), enabled: connected, checked: None };
    let page = |path: &str, label: &str| action(format!("{PAGE_PREFIX}{path}"), label);

    // The company the page is on names the menu. Without the list, Paperclip's own overview of the companies does the switching.
    let known = client.known_companies();
    let current = known.as_ref().and_then(|known| known.current_company());
    let mut company = match known.as_ref().and_then(|known| known.companies.as_ref()).filter(|companies| !companies.is_empty()) {
        Some(companies) => companies.iter().map(|company| check(format!("{COMPANY_PREFIX}{}", company.id), company.name.clone(), Some(company) == current)).collect(),
        None => vec![page("companies", i18n::t("Firma wechseln …"))],
    };
    company.extend([
        Entry::Separator,
        page("company/settings", i18n::t("Firmeneinstellungen")),
        page("company/import", i18n::t("Firma importieren …")),
        page("company/export", i18n::t("Firma exportieren …")),
        Entry::Separator,
        action("paperclip.new_company".into(), i18n::t("Neue Firma …")),
        action(SHELL_TEMPLATES.into(), i18n::t("Firma aus Vorlage …")),
    ]);
    let company_label = current.map_or_else(|| i18n::t("Firma").to_owned(), |company| company.name.clone());

    let new = vec![action("paperclip.new_issue".into(), i18n::t("Neue Aufgabe …")), page("agents/new", i18n::t("Neuer Agent …")), Entry::Separator, action("paperclip.search".into(), i18n::t("Suchen …"))];

    let go = vec![
        label(i18n::t("Arbeit")),
        page("dashboard", i18n::t("Dashboard")),
        page("inbox", i18n::t("Posteingang")),
        page("issues", i18n::t("Aufgaben")),
        label(i18n::t("Team")),
        page("agents", i18n::t("Agenten")),
        page("approvals", i18n::t("Genehmigungen")),
        page("costs", i18n::t("Kosten")),
    ];

    // Reading first, then everything for looking into a problem, then the app itself; the project page and the licenses are in its About box.
    let help = vec![
        item("help.docs", i18n::t("Paperclip-Dokumentation")),
        item("help.report_issue", i18n::t("Problem melden …")),
        Entry::Separator,
        item("help.logs", i18n::t("Protokoll")),
        item("help.data_folder", i18n::t("Datenordner öffnen")),
        item("view.devtools", i18n::t("Entwicklertools")),
        Entry::Separator,
        item(SHELL_UPDATES, i18n::t("Nach Updates suchen …")),
        item("help.about", i18n::t("Über PaperclipDesk")),
    ];

    [(company_label.as_str(), company), (i18n::t("Neu"), new), (i18n::t("Gehe zu"), go), (i18n::t("Hilfe"), help)].into_iter().map(|(label, entries)| Menu { label: label.to_owned(), entries }).collect()
}

/// The places to connect to, the open ones ticked: an entry opens its connection or brings it to the front. Editing and managing below.
pub fn connection_entries(client: &Client) -> Vec<Entry> {
    let recent = client.store.lock().unwrap().recent_remote_profiles(RECENT_CONNECTIONS);
    let open = client.open_profile_ids();
    let connected_to = |profile_id: &str| open.iter().any(|id| id == profile_id);
    let mut connection = vec![check("connection.local".into(), i18n::t("Lokal").into(), connected_to(LOCAL_PROFILE_ID))];
    for profile in &recent {
        let host = profile.remote_url.as_deref().and_then(|url| tauri::Url::parse(url).ok()).and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_default();
        connection.push(check(format!("{RECENT_PREFIX}{}", profile.id), i18n::f("{} (Remote: {})", &[&profile.name, &host]), connected_to(&profile.id)));
    }
    connection.extend(client.open_unsaved_connections().into_iter().map(|(key, name)| check(format!("{OPEN_PREFIX}{key}"), name, true)));
    connection.extend([Entry::Separator, item(SHELL_CONNECTIONS, i18n::t("Remotes bearbeiten …")), item("connection.chooser", i18n::t("Remote-Verbindungen verwalten …"))]);
    connection
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
        "app.quit" => client.handle().exit(0),
        "paperclip.new_issue" => client.open_command_palette(Some("Create new task")),
        "paperclip.search" => client.open_command_palette(None),
        "paperclip.new_company" => client.new_company(),
        "connection.chooser" => client.show_launcher(LauncherView::Chooser, None, None),
        "connection.local" => client.boot_local(false),
        "view.zoom_reset" => client.change_zoom(None),
        "view.zoom_in" => client.change_zoom(Some(ZOOM_STEP)),
        "view.zoom_out" => client.change_zoom(Some(-ZOOM_STEP)),
        "view.fullscreen" => client.toggle_full_screen(),
        "help.logs" => client.show_page(LauncherPage::Logs),
        "help.data_folder" => {
            if let Err(e) = tauri_plugin_opener::open_path(&client.paths.user_data, None::<&str>) {
                tracing::warn!("opening the data folder: {e}");
            }
        }
        "help.report_issue" => {
            if let Err(e) = open_project_link(&client, ProjectLink::ReportIssue) {
                tracing::warn!("opening a project page: {e}");
            }
        }
        "help.about" => show_about(&client),
        "help.docs" => {
            if let Err(e) = tauri_plugin_opener::open_url(DOCS_URL, None::<&str>) {
                tracing::warn!("opening the documentation: {e}");
            }
        }
        other => {
            if let Some(id) = other.strip_prefix(COMPANY_PREFIX) {
                client.switch_company(id);
            } else if let Some(path) = other.strip_prefix(PAGE_PREFIX) {
                client.open_company_page(path);
            } else if let Some(profile_id) = other.strip_prefix(RECENT_PREFIX) {
                client.boot_saved_profile(profile_id);
            } else if let Some(key) = other.strip_prefix(OPEN_PREFIX) {
                client.activate_connection(key);
            } else if client.window().is_some() {
                let webview = client.active_webview();
                let done = match other {
                    "view.reload" => webview.map_or(Ok(()), |webview| webview.reload()),
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

/// The versions, and the way to the project page and to the licenses that ship with the app.
fn show_about(client: &Client) {
    let (repository, licenses) = (i18n::t("Projekt auf GitHub"), i18n::t("Lizenzen Dritter"));
    let description = i18n::t("PaperclipDesk macht Paperclip zu einem Windows-Programm: Es startet den Server samt Datenbank selbst oder verbindet sich mit einem Remote – ohne Terminal und ohne Browser-Tab. Open Source unter der MIT-Lizenz, ohne Telemetrie.");
    let versions = i18n::f("PaperclipDesk {}\nPaperclip-Server: {}\n\nDaten: {}", &[&env!("CARGO_PKG_VERSION"), &client.local_server_version().as_deref().unwrap_or("–"), &client.paths.user_data.display()]);
    let dialog = client
        .handle()
        .dialog()
        .message(format!("{description}\n\n{versions}"))
        .title(i18n::t("Über PaperclipDesk"))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::YesNoCancelCustom(repository.into(), licenses.into(), "OK".into()));
    let picked = match client.window() {
        Some(window) => dialog.parent(&window).blocking_show_with_result(),
        None => dialog.blocking_show_with_result(),
    };
    let opened = match picked {
        MessageDialogResult::Custom(label) if label == repository => open_project_link(client, ProjectLink::Repository),
        MessageDialogResult::Custom(label) if label == licenses => client.handle().path().resource_dir().map_err(|e| e.to_string()).and_then(|dir| tauri_plugin_opener::open_path(dir.join(LICENSES_FILE), None::<&str>).map_err(|e| e.to_string())),
        _ => Ok(()),
    };
    if let Err(e) = opened {
        tracing::warn!("opening from the About box: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::github_repository;

    #[test]
    fn a_template_source_stays_on_its_repository() {
        assert_eq!(github_repository("garrytan/gstack").as_deref(), Ok("https://github.com/garrytan/gstack"));
        assert_eq!(github_repository("HKUDS/ClawTeam").as_deref(), Ok("https://github.com/HKUDS/ClawTeam"));
        for wrong in ["", "gstack", "a/b/c", "../x", "a/..", "a/b?c", "a/b#c", "a b/c", "@evil.com/x"] {
            assert!(github_repository(wrong).is_err(), "{wrong}");
        }
    }
}
