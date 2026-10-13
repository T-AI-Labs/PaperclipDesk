use crate::i18n;
use std::collections::VecDeque;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::webview::{Webview, WebviewBuilder};
use tauri::window::{Window, WindowBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::connection::http::UreqFetch;
use crate::connection::preflight::{preflight_remote_connection, probe_session};
use crate::connection::profiles::{ConnectionStore, RemoteProfileInput, connections_file_path, now_iso};
use crate::connection::types::{BootstrapStatus, ConnectionMode, ConnectionProfile, ConnectionState, FailureReason, LOCAL_PROFILE_ID, RemotePreflightResult, SessionState};
use crate::connection::validate::normalize_remote_url;
use crate::connection::window_policy::{LOCAL_PARTITION, is_navigation_allowed, remote_partition, should_open_externally};
use crate::paths::DataPaths;
use crate::server::{self, ServerLayout};
use crate::server_package;
use crate::settings::{self, Settings};

/// The window of the app; it holds the shell and, once connected, Paperclip as webviews, one shown at a time.
pub const WINDOW_LABEL: &str = "main";
/// The webview with the app's own pages: connection and settings.
pub const LAUNCHER_LABEL: &str = "shell";
pub const STATE_EVENT: &str = "launcher:state";
const PAGE_LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_secs(30);
const SERVER_OUTPUT_LINES: usize = 200;
const INSECURE_HTTP_NOT_CONFIRMED: &str = "HTTP-Remotes erfordern die Bestätigung, dass du eine unsichere Verbindung zulassen möchtest.";
/// How long a dev build waits for Vite before it loads the page anyway.
#[cfg(dev)]
const DEV_SERVER_WAIT: Duration = Duration::from_secs(60);
#[cfg(dev)]
const LOADING_PAGE: &str = "data:text/html;charset=utf-8,<!doctype html><html lang=de><head><meta charset=utf-8><title>PaperclipDesk</title><style>body{margin:0;height:100vh;display:grid;place-items:center;font-family:'Segoe UI Variable','Segoe UI',sans-serif;background:rgb(255,255,255);color:rgb(10,10,10)}.logo{width:56px;height:56px;border-radius:16px;background:rgb(23,23,23);display:grid;place-items:center;margin:0 auto 16px}.logo span{width:22px;height:22px;border-radius:50px;border:3px solid rgb(250,250,250);border-top-color:transparent;animation:spin .9s linear infinite}p{margin:0;text-align:center}.title{font-size:18px;font-weight:600}.detail{font-size:14px;color:rgb(115,115,115);margin-top:4px}@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-color-scheme:dark){body{background:rgb(10,10,10);color:rgb(250,250,250)}.logo{background:rgb(229,229,229)}.logo span{border-color:rgb(23,23,23);border-top-color:transparent}.detail{color:rgb(161,161,161)}}</style></head><body><div><div class=logo><span></span></div><p class=title>PaperclipDesk startet …</p><p class=detail>Warte auf den Entwicklungsserver</p></div></body></html>";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum LauncherView {
    Chooser,
    LocalBoot,
    Connecting,
    Error,
}

/// The pages of the app's own window; each has its menu entry.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum LauncherPage {
    Paperclip,
    Connect,
    Connections,
    Logs,
    Appearance,
    System,
    Server,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum BootStep {
    Init,
    Database,
    Server,
    Ready,
}

#[derive(Serialize, Clone, Debug)]
pub struct BootStatus {
    step: BootStep,
    detail: String,
    progress: u8,
}

#[derive(Serialize, Clone, Debug)]
pub struct ConnectionError {
    title: String,
    detail: String,
}

/// What the app's own window shows; the window may open later than a boot starts, so it reads this instead of following events only.
struct Launcher {
    page: LauncherPage,
    view: LauncherView,
    /// Bumped whenever the app itself changes the page or view, so the window can tell that from its own navigation.
    view_seq: u64,
    label: Option<String>,
    url: Option<String>,
    boot_status: Option<BootStatus>,
    connection_error: Option<ConnectionError>,
}

#[derive(Clone, Debug)]
pub struct CurrentConnection {
    pub mode: ConnectionMode,
    pub profile_id: Option<String>,
    pub start_url: String,
    pub allowed_origin: String,
    pub partition: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    view: LauncherView,
    view_seq: u64,
    page: LauncherPage,
    label: Option<String>,
    url: Option<String>,
    boot_status: Option<BootStatus>,
    connection_error: Option<ConnectionError>,
    has_current_connection: bool,
    current_connection_name: Option<String>,
    current_profile_id: Option<String>,
    state: ConnectionState,
    profiles: Vec<ConnectionProfile>,
    local_server_version: Option<String>,
    local_server_installed: bool,
    /// The language the app speaks, after "System" has been resolved.
    language: &'static str,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteConnect {
    pub profile_id: Option<String>,
    pub remote_url: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub save_profile: bool,
    /// `Some` when the user chose in the window whether to reconnect on launch; `None` leaves the preference alone.
    pub remember_choice: Option<bool>,
    #[serde(default)]
    pub allow_insecure_http: bool,
}

/// What a starting server has printed and how far the boot got.
#[derive(Default)]
struct BootProgress {
    database_ready: AtomicBool,
    listening: AtomicBool,
    shown: AtomicU8,
    output: Mutex<VecDeque<String>>,
    exit: Mutex<Option<Option<i32>>>,
}

impl BootProgress {
    fn tail(&self, lines: usize) -> String {
        let output = self.output.lock().unwrap();
        output.iter().skip(output.len().saturating_sub(lines)).cloned().collect::<Vec<_>>().join("\n")
    }
}

pub struct Client {
    handle: AppHandle,
    pub paths: DataPaths,
    pub store: Mutex<ConnectionStore>,
    pub settings: Mutex<Settings>,
    launcher: Mutex<Launcher>,
    launcher_opening: Mutex<()>,
    current: Mutex<Option<CurrentConnection>>,
    server_pid: Mutex<Option<u32>>,
    main_label: Mutex<Option<String>>,
    window_counter: AtomicU32,
    boot_sequence: AtomicU64,
    monitor_generation: AtomicU64,
    failure_dialog_open: AtomicBool,
    quitting: AtomicBool,
    zoom: Mutex<f64>,
    menu_signature: Mutex<String>,
    layout: Mutex<Option<(String, u32, u32)>>,
}

impl Client {
    pub fn new(handle: AppHandle, paths: DataPaths) -> Arc<Self> {
        let settings = settings::load(&settings::file_path(&paths.user_data));
        i18n::set(&settings.language);
        Arc::new(Self {
            store: Mutex::new(ConnectionStore::open(connections_file_path(&paths.user_data))),
            settings: Mutex::new(settings),
            handle,
            paths,
            launcher: Mutex::new(Launcher { page: LauncherPage::Connect, view: LauncherView::Chooser, view_seq: 0, label: None, url: None, boot_status: None, connection_error: None }),
            launcher_opening: Mutex::default(),
            current: Mutex::default(),
            server_pid: Mutex::default(),
            main_label: Mutex::default(),
            window_counter: AtomicU32::new(0),
            boot_sequence: AtomicU64::new(0),
            monitor_generation: AtomicU64::new(0),
            failure_dialog_open: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            zoom: Mutex::new(1.0),
            menu_signature: Mutex::default(),
            layout: Mutex::default(),
        })
    }

    pub fn handle(&self) -> &AppHandle {
        &self.handle
    }

    fn layout(&self) -> Result<ServerLayout, String> {
        ServerLayout::find(&self.paths.server_packages())
    }

    /// The installed server's version, or the one the app would download.
    pub fn local_server_version(&self) -> Option<String> {
        match self.layout() {
            Ok(layout) => layout.version(),
            Err(_) => server_package::can_download().then(|| server_package::VERSION.to_owned()),
        }
    }

    /// Fetches the server package on the first local start; the boot view shows how far it is.
    fn install_server(&self, boot_id: u64) -> Result<(), String> {
        let megabytes = |bytes: u64| bytes / 1_048_576;
        let shown = AtomicU64::new(u64::MAX);
        server_package::install(
            &self.paths.server_packages(),
            |done, total| {
                let (step, detail) = match total {
                    Some(total) if total > 0 => (done * 100 / total, i18n::f("Paperclip-Server wird heruntergeladen … {} von {} MB", &[&megabytes(done), &megabytes(total)])),
                    Some(_) => (megabytes(done), i18n::f("Paperclip-Server wird heruntergeladen … {} MB", &[&megabytes(done)])),
                    None => (0, i18n::t("Paperclip-Server wird entpackt …").to_owned()),
                };
                if shown.swap(step, Ordering::SeqCst) != step && !self.superseded(boot_id) {
                    self.boot_status(BootStep::Init, &detail, 5);
                }
            },
            || self.superseded(boot_id),
        )
    }

    pub fn snapshot(&self) -> Snapshot {
        let launcher = self.launcher.lock().unwrap();
        let store = self.store.lock().unwrap();
        let current = self.current.lock().unwrap();
        Snapshot {
            view: launcher.view,
            view_seq: launcher.view_seq,
            page: launcher.page,
            label: launcher.label.clone(),
            url: launcher.url.clone(),
            boot_status: launcher.boot_status.clone(),
            connection_error: launcher.connection_error.clone(),
            has_current_connection: current.is_some(),
            current_connection_name: current.as_ref().map(|connection| connection_name(connection, &store)),
            current_profile_id: current.as_ref().and_then(|connection| connection.profile_id.clone()),
            state: store.state().clone(),
            profiles: store.list_profiles(),
            local_server_version: self.local_server_version(),
            local_server_installed: self.layout().is_ok(),
            language: i18n::current(),
        }
    }

    /// Tells the app's window what changed and brings the menu's recent connections and checkbox up to date.
    pub fn send_state(&self) {
        if let Err(e) = self.handle.emit_to(LAUNCHER_LABEL, STATE_EVENT, self.snapshot()) {
            tracing::warn!("sending the launcher state: {e}");
        }
        self.relayout();
        self.refresh_menu();
    }

    pub fn current_profile_id(&self) -> Option<String> {
        self.current.lock().unwrap().as_ref().and_then(|connection| connection.profile_id.clone())
    }

    /// A click ticks a menu entry by itself; the next refresh puts the ticks back where they belong.
    pub fn invalidate_menu(&self) {
        self.menu_signature.lock().unwrap().clear();
    }

    /// Replacing the menu redraws the window, so it only happens when an entry changed.
    fn refresh_menu(&self) {
        let signature = {
            let current = self.current_profile_id();
            let recent: Vec<_> = self.store.lock().unwrap().recent_remote_profiles(crate::menu::RECENT_CONNECTIONS).into_iter().map(|profile| (profile.id, profile.name, profile.remote_url)).collect();
            format!("{}|{current:?}|{}|{}|{:?}|{recent:?}", i18n::current(), self.paperclip_webview().is_some(), self.zoom_percent(), self.local_server_version())
        };
        let Some(window) = self.window() else { return };
        let mut shown = self.menu_signature.lock().unwrap();
        if *shown == signature {
            return;
        }
        match crate::menu::build(self).and_then(|menu| window.set_menu(menu)) {
            Ok(_) => *shown = signature,
            Err(e) => tracing::warn!("rebuilding the menu: {e}"),
        }
    }

    /// The title bar and the menu bar follow the app's colour scheme instead of only Windows' own.
    pub fn apply_color_scheme(&self) {
        let theme = match self.settings.lock().unwrap().color_scheme.as_str() {
            "dark" => Some(tauri::Theme::Dark),
            "light" => Some(tauri::Theme::Light),
            _ => None,
        };
        let _ = self.handle.run_on_main_thread(move || crate::menu::apply_color_scheme(theme));
        if let Some(window) = self.window()
            && let Err(e) = window.set_theme(theme)
        {
            tracing::warn!("applying the colour scheme to the window: {e}");
        }
    }

    pub fn window(&self) -> Option<Window> {
        self.handle.get_window(WINDOW_LABEL)
    }

    /// The page the user is looking at: Paperclip while it is the main view, the app's own page otherwise.
    pub fn active_webview(&self) -> Option<Webview> {
        let on_paperclip = self.launcher.lock().unwrap().page == LauncherPage::Paperclip;
        on_paperclip.then(|| self.paperclip_webview()).flatten().or_else(|| self.handle.get_webview(LAUNCHER_LABEL))
    }

    /// The webviews are laid out by hand: Paperclip fills the window while it is the main view, the shell for its own pages.
    pub fn relayout(&self) {
        let Some(window) = self.window() else { return };
        let Ok(size) = window.inner_size() else { return };
        if size.width == 0 || size.height == 0 {
            return;
        }
        let paperclip = self.paperclip_webview();
        let on_paperclip = paperclip.is_some() && self.launcher.lock().unwrap().page == LauncherPage::Paperclip;
        let shown = paperclip.as_ref().filter(|_| on_paperclip).map_or_else(|| LAUNCHER_LABEL.to_owned(), |webview| webview.label().to_owned());
        // Showing and resizing a webview that already sits right makes it flicker.
        let layout = (shown, size.width, size.height);
        let mut applied = self.layout.lock().unwrap();
        if applied.as_ref() == Some(&layout) {
            return;
        }
        for (webview, visible) in [(self.handle.get_webview(LAUNCHER_LABEL), !on_paperclip), (paperclip, on_paperclip)] {
            let Some(webview) = webview else { continue };
            if visible {
                let _ = webview.set_position(tauri::PhysicalPosition::new(0, 0));
                let _ = webview.set_size(size);
                let _ = webview.show();
            } else {
                let _ = webview.hide();
            }
        }
        *applied = Some(layout);
    }

    /// Opens the app's own window on one of its pages.
    pub fn show_page(&self, page: LauncherPage) {
        let page = if page == LauncherPage::Paperclip && self.paperclip_webview().is_none() { LauncherPage::Connect } else { page };
        {
            let mut launcher = self.launcher.lock().unwrap();
            launcher.page = page;
            launcher.view_seq += 1;
        }
        if let Err(e) = self.open_launcher_window() {
            tracing::error!("opening the launcher window: {e}");
        }
        self.send_state();
    }

    fn navigate(&self, view: LauncherView, label: Option<&str>, url: Option<&str>) {
        let mut launcher = self.launcher.lock().unwrap();
        launcher.page = LauncherPage::Connect;
        launcher.view = view;
        launcher.view_seq += 1;
        launcher.label = label.map(str::to_owned);
        launcher.url = url.map(str::to_owned);
        if view == LauncherView::LocalBoot {
            launcher.boot_status = None;
        }
    }

    /// Opens the app's own window, or brings it to the front, on the given view.
    pub fn show_launcher(&self, view: LauncherView, label: Option<&str>, url: Option<&str>) {
        self.navigate(view, label, url);
        if let Err(e) = self.open_launcher_window() {
            tracing::error!("opening the launcher window: {e}");
        }
        self.send_state();
    }

    fn open_launcher_window(&self) -> tauri::Result<()> {
        let _opening = self.launcher_opening.lock().unwrap();
        if let Some(window) = self.window() {
            window.unminimize()?;
            window.show()?;
            return window.set_focus();
        }
        let config = self.handle.config().app.windows.iter().find(|w| w.label == WINDOW_LABEL).expect("main window in tauri.conf.json");
        let window = WindowBuilder::from_config(&self.handle, config)?.menu(crate::menu::build(self)?).build()?;
        // Its own browser profile under the app's data, so a run with moved data shares nothing with an installed one.
        let profile = self.paths.webview_data.join("launcher");
        add_shell(&window, config.url.clone(), profile)?;
        self.apply_color_scheme();
        self.relayout();
        Ok(())
    }

    /// Makes Paperclip the main view and puts the keyboard focus into it.
    fn show_paperclip(&self) {
        self.launcher.lock().unwrap().page = LauncherPage::Paperclip;
        self.send_state();
        if let Some(paperclip) = self.paperclip_webview() {
            let _ = paperclip.set_focus();
        }
    }

    fn boot_status(&self, step: BootStep, detail: &str, progress: u8) {
        self.launcher.lock().unwrap().boot_status = Some(BootStatus { step, detail: detail.to_owned(), progress });
        self.send_state();
    }

    fn fail(&self, title: &str, detail: String) {
        tracing::error!("{title}: {detail}");
        self.launcher.lock().unwrap().connection_error = Some(ConnectionError { title: title.to_owned(), detail });
        self.navigate(LauncherView::Error, None, None);
        self.send_state();
    }

    fn next_boot(&self) -> u64 {
        self.boot_sequence.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn superseded(&self, boot_id: u64) -> bool {
        self.boot_sequence.load(Ordering::SeqCst) != boot_id
    }

    pub fn paperclip_webview(&self) -> Option<Webview> {
        let label = self.main_label.lock().unwrap().clone()?;
        self.handle.get_webview(&label)
    }

    /// The webview Paperclip itself runs in: locked to the connection's origin, with its own browser profile and no access to the app's commands.
    fn create_main_window(&self, connection: &CurrentConnection) -> tauri::Result<(Webview, mpsc::Receiver<()>)> {
        self.open_launcher_window()?;
        let window = self.window().ok_or(tauri::Error::WindowNotFound)?;
        let label = format!("paperclip-{}", self.window_counter.fetch_add(1, Ordering::SeqCst) + 1);
        let start_url = tauri::Url::parse(&connection.start_url).map_err(|e| tauri::Error::Anyhow(e.into()))?;
        let (loaded, load_finished) = mpsc::channel();
        let (navigation_origin, popup_origin) = (connection.allowed_origin.clone(), connection.allowed_origin.clone());

        let builder = WebviewBuilder::new(&label, WebviewUrl::External(start_url))
            .background_color(tauri::window::Color(10, 10, 10, 255))
            .data_directory(self.paths.webview_data.join(&connection.partition))
            .zoom_hotkeys_enabled(true)
            .on_navigation(move |target| {
                if is_navigation_allowed(target.as_str(), &navigation_origin) {
                    return true;
                }
                open_externally(target.as_str(), &navigation_origin);
                false
            })
            .on_new_window(move |target, _features| {
                open_externally(target.as_str(), &popup_origin);
                NewWindowResponse::Deny
            })
            .on_page_load(move |_webview, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    let _ = loaded.send(());
                }
            });
        let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
        let webview = window.add_child(builder, LogicalPosition::new(0.0, 0.0), LogicalSize::new(size.width.max(1.0), size.height.max(1.0)))?;
        webview.hide()?;
        Ok((webview, load_finished))
    }

    /// Creates the webview hidden and waits until the page has loaded.
    fn open_main_window(&self, connection: &CurrentConnection) -> Result<Webview, String> {
        let (webview, load_finished) = self.create_main_window(connection).map_err(|e| e.to_string())?;
        if load_finished.recv_timeout(PAGE_LOAD_TIMEOUT).is_err() {
            let _ = webview.close();
            return Err(i18n::f("{} hat nicht innerhalb von {} Sekunden geladen.", &[&connection.start_url, &PAGE_LOAD_TIMEOUT.as_secs()]));
        }
        Ok(webview)
    }

    fn replace_main_window(&self, next: &Webview) {
        let previous = self.main_label.lock().unwrap().replace(next.label().to_owned());
        *self.zoom.lock().unwrap() = 1.0;
        self.fit_window_to_paperclip();
        if let Some(webview) = previous.and_then(|label| self.handle.get_webview(&label)) {
            let _ = webview.close();
        }
    }

    /// Paperclip needs more room than the connection pages; the window grows once, to what its monitor allows, around the place the user left it at.
    fn fit_window_to_paperclip(&self) {
        let Some(window) = self.window() else { return };
        let Some(monitor) = window.current_monitor().ok().flatten() else { return };
        let available = monitor.size().to_logical::<f64>(monitor.scale_factor());
        let wanted = ((available.width - 80.0).clamp(900.0, 1440.0), (available.height - 120.0).clamp(600.0, 900.0));
        let Ok(current) = window.inner_size().map(|size| size.to_logical::<f64>(window.scale_factor().unwrap_or(1.0))) else { return };
        if current.width >= wanted.0 - 100.0 && current.height >= wanted.1 - 100.0 {
            return;
        }
        let (Ok(position), Ok(before)) = (window.outer_position(), window.outer_size()) else { return };
        let _ = window.set_size(LogicalSize::new(wanted.0, wanted.1));
        let Ok(after) = window.outer_size() else { return };
        let area = monitor.work_area();
        let grown = |position: i32, before: u32, after: u32, start: i32, length: u32| (position - (after as i32 - before as i32) / 2).min(start + length as i32 - after as i32).max(start);
        let (x, y) = (grown(position.x, before.width, after.width, area.position.x, area.size.width), grown(position.y, before.height, after.height, area.position.y, area.size.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }

    /// Shows the connection's webview again, e.g. after the user went to the settings.
    pub fn reopen_current_connection_window(&self) -> bool {
        if self.paperclip_webview().is_some() {
            self.show_paperclip();
            return true;
        }
        let Some(connection) = self.current.lock().unwrap().clone() else {
            return false;
        };
        match self.open_main_window(&connection) {
            Ok(webview) => {
                self.replace_main_window(&webview);
                self.show_paperclip();
                true
            }
            Err(e) => {
                tracing::warn!("reopening the Paperclip view: {e}");
                false
            }
        }
    }

    pub fn return_to_current_session(&self) -> bool {
        let opened = self.reopen_current_connection_window();
        if opened {
            self.show_paperclip();
        }
        opened
    }

    /// A second start of the app lands here.
    pub fn focus_existing(&self) {
        if self.paperclip_webview().is_some() {
            self.reopen_current_connection_window();
        } else if self.window().is_some() {
            let _ = self.open_launcher_window();
        } else {
            self.show_launcher(LauncherView::Chooser, None, None);
        }
    }

    fn track_server(&self, pid: Option<u32>) {
        *self.server_pid.lock().unwrap() = pid;
        server::write_pid_file(&self.paths.user_data, pid);
    }

    fn kill_server(&self) {
        self.stop_monitor();
        let pid = self.server_pid.lock().unwrap().take();
        if let Some(pid) = pid {
            server::kill_process_tree(pid);
            // Ending the tree can leave one PostgreSQL worker behind, and the next start would fail on it.
            if let Ok(layout) = self.layout() {
                server::kill_stale_postgres(&layout);
            }
        }
        server::write_pid_file(&self.paths.user_data, None);
    }

    /// Stops a server whose boot failed or was overtaken, and tracks the one that ran before it again.
    fn abandon_attempt(&self, attempted: Option<u32>, previous: Option<u32>) {
        let tracked = *self.server_pid.lock().unwrap();
        let Some(pid) = attempted.filter(|_| server::is_same_process(tracked, attempted)) else {
            return;
        };
        // Untracked first, so the exit that follows is not taken for a crash.
        self.track_server(previous.filter(|_| server::should_restore_previous_server(previous, attempted, tracked)));
        server::kill_process_tree(pid);
    }

    fn stop_monitor(&self) {
        self.monitor_generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Asks the local server for its health every 30 seconds and offers a restart when it stops answering.
    fn start_monitor(self: &Arc<Self>, probe_origin: String, allowed_origin: String) {
        let generation = self.monitor_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let client = Arc::clone(self);
        std::thread::spawn(move || {
            let current = |client: &Client| client.monitor_generation.load(Ordering::SeqCst) == generation && !client.quitting.load(Ordering::SeqCst);
            while current(&client) {
                let watched = client.current.lock().unwrap().as_ref().is_some_and(|c| c.mode == ConnectionMode::LocalEmbedded && c.allowed_origin == allowed_origin);
                if watched
                    && let Err(detail) = server::probe_local_server_health(&probe_origin, &UreqFetch::default())
                    && current(&client)
                {
                    client.prompt_to_recover(i18n::t("Der eingebettete Paperclip-Server antwortet nicht mehr."), &detail);
                    return;
                }
                let next_check = Instant::now() + HEALTH_POLL_INTERVAL;
                while Instant::now() < next_check && current(&client) {
                    std::thread::sleep(Duration::from_millis(250));
                }
            }
        });
    }

    fn prompt_to_recover(self: &Arc<Self>, message: &str, detail: &str) {
        let local = self.current.lock().unwrap().as_ref().is_some_and(|c| c.mode == ConnectionMode::LocalEmbedded);
        if self.quitting.load(Ordering::SeqCst) || !local || self.failure_dialog_open.swap(true, Ordering::SeqCst) {
            return;
        }
        self.stop_monitor();
        tracing::warn!("{message} {detail}");

        let dialog = self
            .handle
            .dialog()
            .message(format!("{message}\n\n{detail}\n\n{}", i18n::t("Starte den lokalen Server neu, um fortzufahren.")))
            .title(i18n::t("Lokales Paperclip nicht verfügbar"))
            .kind(MessageDialogKind::Error)
            .buttons(MessageDialogButtons::OkCancelCustom(i18n::t("Lokal neu starten").into(), i18n::t("Beenden").into()));
        let restart = match self.window() {
            Some(window) => dialog.parent(&window).blocking_show(),
            None => dialog.blocking_show(),
        };
        self.failure_dialog_open.store(false, Ordering::SeqCst);
        tracing::info!(restart, "recovery dialog answered");

        if restart {
            self.boot_local(None, true);
        } else {
            self.handle.exit(0);
        }
    }

    fn remember_local(&self, remember_choice: Option<bool>) {
        let mut store = self.store.lock().unwrap();
        store.record_local_connection(&now_iso());
        if let Some(remember) = remember_choice {
            store.set_remembered_profile(Some(LOCAL_PROFILE_ID), remember);
        }
    }

    /// Starts the bundled server and opens Paperclip on it. `remember_choice` is `Some` when the user chose whether to do this on every launch.
    pub fn boot_local(self: &Arc<Self>, remember_choice: Option<bool>, force_restart: bool) {
        let boot_id = self.next_boot();
        self.stop_monitor();
        let current = self.current.lock().unwrap().clone();
        let running_local = current.filter(|connection| connection.mode == ConnectionMode::LocalEmbedded);

        if !force_restart
            && let Some(connection) = &running_local
            && self.paperclip_webview().is_some()
        {
            self.remember_local(remember_choice);
            self.send_state();
            self.reopen_current_connection_window();
            self.show_paperclip();
            self.start_monitor(connection.start_url.replace("localhost", "127.0.0.1"), connection.allowed_origin.clone());
            return;
        }

        let previous_server = running_local.and_then(|_| *self.server_pid.lock().unwrap());
        self.show_launcher(LauncherView::LocalBoot, None, None);
        let mut attempted = None;
        if let Err(error) = self.start_local(boot_id, previous_server, remember_choice, &mut attempted) {
            self.abandon_attempt(attempted, previous_server);
            if !self.superseded(boot_id) {
                self.fail(i18n::t("Lokales Paperclip konnte nicht gestartet werden"), error);
            }
        }
    }

    /// Gives up the connection that is being made; the boot notices at its next step and cleans up after itself.
    pub fn cancel_boot(&self) {
        self.next_boot();
        self.navigate(LauncherView::Chooser, None, None);
        self.send_state();
    }

    fn start_local(self: &Arc<Self>, boot_id: u64, previous_server: Option<u32>, remember_choice: Option<bool>, attempted: &mut Option<u32>) -> Result<(), String> {
        self.boot_status(BootStep::Init, i18n::t("Umgebung wird vorbereitet …"), 5);
        let layout = match self.layout() {
            Ok(layout) => layout,
            Err(_) => {
                self.install_server(boot_id)?;
                self.layout()?
            }
        };
        if previous_server.is_none() && self.server_pid.lock().unwrap().is_none() {
            server::kill_stale_postgres(&layout);
        }
        let port = server::find_free_port(server::PREFERRED_PORT)?;
        if self.superseded(boot_id) {
            return Ok(());
        }

        self.boot_status(BootStep::Database, i18n::t("Eingebettetes PostgreSQL wird gestartet …"), 15);
        let log_path = self.paths.server_log();
        let log = match server::open_server_log(&log_path) {
            Ok(mut file) => {
                let _ = writeln!(file, "\n--- Server start {} (port={port}) ---", now_iso());
                Some(file)
            }
            Err(e) => {
                tracing::warn!("opening {}: {e}", log_path.display());
                None
            }
        };
        let log = Arc::new(Mutex::new(log));
        let progress = Arc::new(BootProgress::default());
        progress.shown.store(15, Ordering::SeqCst);
        let pid_cell = Arc::new(Mutex::new(None::<u32>));

        let on_line = {
            let (client, progress, log) = (Arc::clone(self), Arc::clone(&progress), Arc::clone(&log));
            Arc::new(move |line: &str| {
                {
                    let mut output = progress.output.lock().unwrap();
                    output.push_back(line.to_owned());
                    while output.len() > SERVER_OUTPUT_LINES {
                        output.pop_front();
                    }
                }
                if let Some(file) = log.lock().unwrap().as_mut() {
                    let _ = writeln!(file, "{line}");
                }
                if (line.contains("PostgreSQL ready") || line.contains("migration")) && !progress.database_ready.swap(true, Ordering::SeqCst) {
                    client.advance(boot_id, &progress, BootStep::Database, i18n::t("Migrationen laufen …"), 35);
                }
                if (line.contains("Server listening on") || line.contains("Server listener bound on")) && !progress.listening.swap(true, Ordering::SeqCst) {
                    client.advance(boot_id, &progress, BootStep::Server, i18n::t("Server startet …"), 55);
                }
            })
        };
        let on_exit = {
            let (client, progress, pid_cell, log_path) = (Arc::clone(self), Arc::clone(&progress), Arc::clone(&pid_cell), log_path.clone());
            move |code: Option<i32>| {
                log.lock().unwrap().take();
                *progress.exit.lock().unwrap() = Some(code);
                let pid = *pid_cell.lock().unwrap();
                if !server::is_same_process(*client.server_pid.lock().unwrap(), pid) {
                    return;
                }
                client.track_server(None);
                client.stop_monitor();
                let tail = progress.tail(30);
                tracing::error!("server exited unexpectedly (code={code:?})\n{tail}");
                client.prompt_to_recover(
                    i18n::t("Der eingebettete Paperclip-Server wurde unerwartet beendet."),
                    &format!("{}\n\n{tail}", i18n::f("Exit-Code: {}\n\nProtokoll: {}", &[&exit_code(code), &log_path.display()])),
                );
            }
        };

        let pid = server::start_server(&layout, port, &self.paths.paperclip_home, on_line, on_exit).map_err(|e| i18n::f("Node.js ({}) ließ sich nicht starten: {}", &[&layout.node.display(), &e]))?;
        *pid_cell.lock().unwrap() = Some(pid);
        *attempted = Some(pid);
        self.track_server(Some(pid));
        tracing::info!(pid, port, home = %self.paths.paperclip_home.display(), "local server started");

        self.advance(boot_id, &progress, BootStep::Server, i18n::t("Warte auf den Server …"), 45);
        let started = Instant::now();
        server::wait_for_port(port, server::STARTUP_TIMEOUT, || {
            if self.superseded(boot_id) {
                return Some(i18n::t("Abgebrochen.").into());
            }
            if let Some(code) = *progress.exit.lock().unwrap() {
                return Some(format!("{}\n\n{}", i18n::f("Der Server wurde beim Start beendet (Exit-Code {}).", &[&exit_code(code)]), progress.tail(30)));
            }
            if started.elapsed() > Duration::from_secs(2) {
                if !progress.database_ready.load(Ordering::SeqCst) {
                    self.advance(boot_id, &progress, BootStep::Database, i18n::t("Eingebettetes PostgreSQL wird gestartet …"), 20);
                } else if !progress.listening.load(Ordering::SeqCst) {
                    self.advance(boot_id, &progress, BootStep::Server, i18n::t("Warte auf den Server …"), 50);
                }
            }
            None
        })?;
        if self.superseded(boot_id) {
            self.abandon_attempt(*attempted, previous_server);
            return Ok(());
        }

        // The port opens before the server has finished its startup recovery; until then its health is "starting".
        let probe_origin = format!("http://127.0.0.1:{port}");
        while let Err(detail) = server::probe_local_server_health(&probe_origin, &UreqFetch::default()) {
            if let Some(code) = *progress.exit.lock().unwrap() {
                return Err(format!("{}\n\n{}", i18n::f("Der Server wurde beim Start beendet (Exit-Code {}).", &[&exit_code(code)]), progress.tail(30)));
            }
            if started.elapsed() > server::STARTUP_TIMEOUT {
                return Err(i18n::f("Der Server ist gestartet, wird aber nicht bereit: {}", &[&detail]));
            }
            if self.superseded(boot_id) {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        if self.superseded(boot_id) {
            self.abandon_attempt(*attempted, previous_server);
            return Ok(());
        }

        self.boot_status(BootStep::Server, i18n::t("Server ist bereit"), 70);
        self.boot_status(BootStep::Ready, i18n::t("Oberfläche wird geladen …"), 80);

        let start_url = format!("http://localhost:{port}");
        let connection = CurrentConnection {
            mode: ConnectionMode::LocalEmbedded,
            profile_id: Some(LOCAL_PROFILE_ID.into()),
            allowed_origin: start_url.clone(),
            start_url,
            partition: LOCAL_PARTITION.into(),
        };
        // A window still open on the local profile keeps these files locked, and then they are current anyway.
        let local_window_open = self.paperclip_webview().is_some() && self.current.lock().unwrap().as_ref().is_some_and(|c| c.mode == ConnectionMode::LocalEmbedded);
        if !local_window_open {
            reset_local_ui_cache(&self.paths.webview_data);
        }
        let window = self.open_main_window(&connection)?;
        if self.superseded(boot_id) {
            let _ = window.close();
            self.abandon_attempt(*attempted, previous_server);
            return Ok(());
        }

        let allowed_origin = connection.allowed_origin.clone();
        *self.current.lock().unwrap() = Some(connection);
        self.replace_main_window(&window);
        if let Some(previous) = previous_server.filter(|_| server::should_kill_superseded_server(previous_server, Some(pid))) {
            server::kill_process_tree(previous);
        }
        self.remember_local(remember_choice);
        self.boot_status(BootStep::Ready, i18n::t("Bereit!"), 100);
        self.start_monitor(format!("http://127.0.0.1:{port}"), allowed_origin);
        self.show_paperclip();
        Ok(())
    }

    /// Boot progress only ever moves forward, whatever order the server's output arrives in.
    fn advance(&self, boot_id: u64, progress: &BootProgress, step: BootStep, detail: &str, value: u8) {
        if self.superseded(boot_id) || progress.shown.fetch_max(value, Ordering::SeqCst) >= value {
            return;
        }
        self.boot_status(step, detail, value);
    }

    /// Verifies the remote and opens Paperclip on it.
    pub fn boot_remote(self: &Arc<Self>, options: RemoteConnect) {
        let boot_id = self.next_boot();
        let previous_mode = self.current.lock().unwrap().as_ref().map(|connection| connection.mode);

        let normalized = normalize_remote_url(&options.remote_url).and_then(|normalized| {
            if normalized.insecure_transport && !options.allow_insecure_http { Err(i18n::t(INSECURE_HTTP_NOT_CONFIRMED).into()) } else { Ok(normalized) }
        });
        let normalized = match normalized {
            Ok(normalized) => normalized,
            Err(detail) => {
                let _ = self.open_launcher_window();
                self.fail(i18n::t("Ungültige Remote-URL"), detail);
                return;
            }
        };

        self.show_launcher(LauncherView::Connecting, Some(i18n::t("Remote wird geprüft …")), Some(&normalized.normalized_url));
        let mut result = preflight_remote_connection(&normalized.normalized_url, self.local_server_version().as_deref(), &UreqFetch::default());
        if self.superseded(boot_id) {
            return;
        }
        let now = now_iso();

        if !result.ok {
            if let Some(profile_id) = &options.profile_id {
                let _ = self.store.lock().unwrap().record_remote_health(profile_id, &result, &now);
            }
            self.fail(remote_error_title(&result), result.detail.clone().unwrap_or_else(|| i18n::t("Der gewählte Remote ließ sich nicht prüfen.").into()));
            return;
        }

        let saved_profile_id = {
            let mut store = self.store.lock().unwrap();
            let saved = match &options.profile_id {
                Some(profile_id) => store.profile(profile_id).map(|profile| profile.id),
                None if options.save_profile || options.remember_choice == Some(true) => store
                    .save_remote_profile(
                        RemoteProfileInput { profile_id: None, name: options.display_name.clone(), remote_url: result.normalized_url.clone(), allow_insecure_http: result.insecure_transport },
                        &now,
                    )
                    .ok()
                    .map(|profile| profile.id),
                None => None,
            };
            if let Some(profile_id) = &saved {
                let _ = store.record_remote_health(profile_id, &result, &now);
            }
            if let Some(remember) = options.remember_choice {
                store.set_remembered_profile(saved.as_deref(), remember);
            }
            saved
        };

        let connection = CurrentConnection {
            mode: ConnectionMode::RemoteExisting,
            partition: remote_partition(saved_profile_id.as_deref().or(options.profile_id.as_deref()), &result.origin),
            profile_id: saved_profile_id.clone(),
            start_url: result.normalized_url.clone(),
            allowed_origin: result.origin.clone(),
        };
        let label = match (result.bootstrap_status, result.session_state) {
            (Some(BootstrapStatus::BootstrapPending), _) => i18n::t("Remote-Einrichtung wird geöffnet …"),
            (_, SessionState::SignedOut) => i18n::t("Remote-Anmeldung wird geöffnet …"),
            _ => i18n::t("Geprüfter Remote wird geöffnet …"),
        };
        self.navigate(LauncherView::Connecting, Some(label), Some(&result.normalized_url));
        self.send_state();

        let window = match self.open_main_window(&connection) {
            Ok(window) => window,
            Err(e) => {
                self.fail(i18n::t("Remote-Paperclip konnte nicht geöffnet werden"), e);
                return;
            }
        };
        if self.superseded(boot_id) {
            let _ = window.close();
            return;
        }

        *self.current.lock().unwrap() = Some(connection);
        self.replace_main_window(&window);
        self.show_paperclip();
        if previous_mode == Some(ConnectionMode::LocalEmbedded) {
            self.kill_server();
        }
        // The check ran without the window's cookies; a session kept from last time only shows with them.
        if result.session_state == SessionState::SignedOut && window_session(&window, &result.origin) == Some(SessionState::SignedIn) {
            result.session_state = SessionState::SignedIn;
        }
        if let Some(profile_id) = &saved_profile_id {
            let _ = self.store.lock().unwrap().record_remote_connection(profile_id, &result, &now_iso());
        }
        self.send_state();
    }

    pub fn boot_saved_profile(self: &Arc<Self>, profile_id: &str, remember_choice: Option<bool>) {
        if profile_id == LOCAL_PROFILE_ID {
            return self.boot_local(remember_choice, false);
        }
        let profile = self.store.lock().unwrap().profile(profile_id);
        let Some((profile, remote_url)) = profile.and_then(|profile| profile.remote_url.clone().map(|url| (profile, url))) else {
            let _ = self.open_launcher_window();
            return self.fail(i18n::t("Verbindung nicht gefunden"), i18n::f("Unbekanntes gespeichertes Profil: {}", &[&profile_id]));
        };
        self.boot_remote(RemoteConnect {
            profile_id: Some(profile.id),
            remote_url,
            display_name: Some(profile.name),
            save_profile: false,
            remember_choice,
            allow_insecure_http: profile.allow_insecure_http == Some(true),
        });
    }

    /// Removes a saved connection together with the browser profile that held its session.
    pub fn delete_profile(&self, profile_id: &str) {
        let partition = remote_partition(Some(profile_id), "");
        let in_use = {
            let mut current = self.current.lock().unwrap();
            match current.as_mut().filter(|connection| connection.partition == partition) {
                Some(connection) => {
                    connection.profile_id = None;
                    true
                }
                None => false,
            }
        };
        if in_use {
            if let Some(window) = self.paperclip_webview() {
                let _ = window.clear_all_browsing_data();
            }
        } else {
            let _ = std::fs::remove_dir_all(self.paths.webview_data.join(&partition));
        }
        self.store.lock().unwrap().delete_remote_profile(profile_id);
        self.send_state();
    }

    /// What the app does first: connect as remembered, or ask.
    pub fn start(self: &Arc<Self>) {
        server::kill_orphaned_server(&self.paths.user_data);
        let startup = self.store.lock().unwrap().startup_profile_id();
        match startup {
            Some(profile_id) => {
                let remote_url = self.store.lock().unwrap().profile(&profile_id).and_then(|profile| profile.remote_url);
                match remote_url {
                    Some(url) => self.show_launcher(LauncherView::Connecting, Some(i18n::t("Geprüfter Remote wird geöffnet …")), Some(&url)),
                    None => self.show_launcher(LauncherView::LocalBoot, None, None),
                }
                let client = Arc::clone(self);
                std::thread::spawn(move || client.boot_saved_profile(&profile_id, None));
            }
            None => {
                self.show_launcher(LauncherView::Chooser, None, None);
            }
        }
    }

    /// Whether Paperclip currently runs on the server of this machine.
    pub fn local_connected(&self) -> bool {
        self.current.lock().unwrap().as_ref().is_some_and(|connection| connection.mode == ConnectionMode::LocalEmbedded)
    }

    /// Ends the local server and closes its view, so its files can be replaced; a connection to a remote stays.
    pub fn stop_local(&self) {
        self.next_boot();
        self.stop_monitor();
        let was_local = {
            let mut current = self.current.lock().unwrap();
            let local = current.as_ref().is_some_and(|connection| connection.mode == ConnectionMode::LocalEmbedded);
            if local {
                current.take();
            }
            local
        };
        if was_local
            && let Some(webview) = self.main_label.lock().unwrap().take().and_then(|label| self.handle.get_webview(&label))
        {
            let _ = webview.close();
        }
        self.kill_server();
        self.send_state();
    }

    /// Whether the server in use is the downloaded package, which the app can fetch again.
    pub fn can_reinstall_server(&self) -> bool {
        server_package::can_download() && self.layout().map_or(true, |layout| layout.cwd == server_package::installed_dir(&self.paths.server_packages()))
    }

    /// Downloads the server package again and starts it.
    pub fn reinstall_server(self: &Arc<Self>) {
        self.stop_local();
        let package = server_package::installed_dir(&self.paths.server_packages());
        if package.exists()
            && let Err(e) = std::fs::remove_dir_all(&package)
        {
            return self.fail(i18n::t("Lokales Paperclip konnte nicht gestartet werden"), format!("{}: {e}", package.display()));
        }
        self.boot_local(None, true);
    }

    /// The local server must not outlive the app.
    pub fn shutdown(&self) {
        tracing::info!("exiting");
        self.quitting.store(true, Ordering::SeqCst);
        self.kill_server();
        if self.settings.lock().unwrap().clear_logs_on_exit {
            crate::logs::clear_all(&self.paths);
        }
    }

    pub fn change_zoom(&self, change: Option<f64>) {
        let zoom = *self.zoom.lock().unwrap();
        self.set_zoom(change.map_or(1.0, |delta| zoom + delta));
    }

    /// Scales Paperclip's own view; 1.0 is its original size.
    pub fn set_zoom(&self, factor: f64) {
        let Some(webview) = self.paperclip_webview() else { return };
        let factor = factor.clamp(0.3, 3.0);
        *self.zoom.lock().unwrap() = factor;
        let _ = webview.set_zoom(factor);
        self.refresh_menu();
    }

    pub fn zoom_percent(&self) -> u32 {
        (*self.zoom.lock().unwrap() * 100.0).round() as u32
    }
}

fn window_session(window: &Webview, origin: &str) -> Option<SessionState> {
    let cookies = window.cookies_for_url(tauri::Url::parse(origin).ok()?).ok()?;
    let cookie = cookies.iter().map(|cookie| format!("{}={}", cookie.name(), cookie.value())).collect::<Vec<_>>().join("; ");
    probe_session(origin, &UreqFetch { cookie: Some(cookie) }).ok()
}

/// The local UI changes with every server version; a service worker or cache of the old one must not serve it.
fn reset_local_ui_cache(webview_data: &std::path::Path) {
    let profile = webview_data.join(LOCAL_PARTITION).join("EBWebView").join("Default");
    for stale in ["Cache", "Code Cache", "Service Worker"] {
        let _ = std::fs::remove_dir_all(profile.join(stale));
    }
}

fn exit_code(code: Option<i32>) -> String {
    code.map_or_else(|| i18n::t("unbekannt").into(), |code| code.to_string())
}

fn open_externally(target: &str, allowed_origin: &str) {
    if should_open_externally(target, allowed_origin)
        && let Err(e) = tauri_plugin_opener::open_url(target, None::<&str>)
    {
        tracing::warn!("opening {target} in the browser: {e}");
    }
}

fn connection_name(connection: &CurrentConnection, store: &ConnectionStore) -> String {
    if connection.mode == ConnectionMode::LocalEmbedded {
        return "Lokal".into();
    }
    let profile = connection.profile_id.as_deref().and_then(|id| store.profile(id));
    let host = || tauri::Url::parse(&connection.start_url).ok().and_then(|url| url.host_str().map(str::to_owned));
    profile.map(|profile| profile.name).or_else(host).unwrap_or_else(|| connection.start_url.clone())
}

fn remote_error_title(result: &RemotePreflightResult) -> &'static str {
    match result.reason {
        Some(FailureReason::UnsupportedLocalTrusted) => i18n::t("Remote nicht geeignet"),
        Some(FailureReason::NotPaperclip) => i18n::t("Kein Paperclip-Endpunkt"),
        Some(FailureReason::TlsError) => i18n::t("TLS-Prüfung fehlgeschlagen"),
        Some(FailureReason::AuthNotReady) => i18n::t("Anmeldung des Remotes nicht bereit"),
        _ => i18n::t("Remote ließ sich nicht prüfen"),
    }
}

/// The shell webview. A dev build loads its pages from Vite, which may still be starting (or answer 500 while it bundles);
/// the webview shows a loading page until Vite answers.
fn add_shell(window: &Window, url: WebviewUrl, profile: std::path::PathBuf) -> tauri::Result<()> {
    let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
    let (position, size) = (LogicalPosition::new(0.0, 0.0), LogicalSize::new(size.width, size.height));
    #[cfg(dev)]
    if let Some(dev_url) = window.app_handle().config().build.dev_url.clone() {
        let waiting = WebviewUrl::External(tauri::Url::parse(LOADING_PAGE).expect("loading page is a valid data URL"));
        let webview = window.add_child(WebviewBuilder::new(LAUNCHER_LABEL, waiting).data_directory(profile), position, size)?;
        std::thread::spawn(move || {
            let deadline = Instant::now() + DEV_SERVER_WAIT;
            while Instant::now() < deadline && ureq::get(dev_url.as_str()).call().is_err() {
                std::thread::sleep(Duration::from_millis(300));
            }
            if let Err(e) = webview.navigate(dev_url) {
                eprintln!("opening the dev server page: {e}");
            }
        });
        return Ok(());
    }
    window.add_child(WebviewBuilder::new(LAUNCHER_LABEL, url).data_directory(profile), position, size).map(|_| ())
}
