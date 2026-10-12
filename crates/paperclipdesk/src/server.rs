use crate::i18n;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::connection::http::Fetch;

pub const PREFERRED_PORT: u16 = 3100;
/// A first start loads the server from a cold disk, creates the database and applies every migration; on Windows that alone can pass a minute.
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(180);
const PORT_RANGE: u16 = 100;
const POLL_INTERVAL: Duration = Duration::from_millis(400);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const PID_FILE_NAME: &str = "paperclip-server.pid";
const LOG_MAX_BYTES: u64 = 20 * 1024 * 1024;
const LOG_ARCHIVE_KEEP: usize = 5;
const LOG_ARCHIVE_PREFIX: &str = "server.log.";
const LOG_UNSAFE_PREFIX: &str = "server.log.unsafe.";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where the bundled server and its Node.js runtime are on disk.
#[derive(Clone, Debug)]
pub struct ServerLayout {
    pub node: PathBuf,
    pub server_dir: PathBuf,
    pub cwd: PathBuf,
}

impl ServerLayout {
    /// The server is next to the exe (`scripts/install.ps1`), downloaded into the app's data, or, for a build run from the
    /// repository, where `npm run prepare-server` staged it.
    pub fn find(packages: &Path) -> Result<Self, String> {
        let downloaded = crate::server_package::installed_dir(packages);
        let installed = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("app-server")));
        let staged = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).map(|root| root.join("build"));
        let candidates = [
            installed.as_ref().map(|root| (root.join("server"), root.join("node-bin").join("node.exe"), root.clone())),
            Some((downloaded.join("server"), downloaded.join("node-bin").join("node.exe"), downloaded.clone())),
            staged.as_ref().map(|build| {
                let bundle = build.join("server-bundle").join("win-x64");
                (bundle.join("server"), build.join("node-bin").join("win-x64").join("node.exe"), bundle)
            }),
        ];
        candidates
            .into_iter()
            .flatten()
            .find(|(server_dir, ..)| server_dir.join("dist").join("index.js").is_file())
            .map(|(server_dir, node, cwd)| Self { node: if node.is_file() { node } else { "node".into() }, server_dir, cwd })
            .ok_or_else(|| i18n::f("Der Paperclip-Server {} ist noch nicht installiert.", &[&crate::server_package::VERSION]))
    }

    pub fn version(&self) -> Option<String> {
        let raw = std::fs::read_to_string(self.server_dir.join("package.json")).ok()?;
        serde_json::from_str::<serde_json::Value>(&raw).ok()?["version"].as_str().map(str::to_owned)
    }

    fn teams_catalog_dir(&self) -> PathBuf {
        self.server_dir.join("node_modules").join("@paperclipai").join("teams-catalog")
    }
}

pub fn is_port_in_use(port: u16) -> bool {
    // Windows takes about two seconds to refuse a closed local port, a listening one answers at once.
    TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, port)), Duration::from_millis(300)).is_ok()
}

pub fn find_free_port(start: u16) -> Result<u16, String> {
    // A start near the top of the port range leaves fewer than PORT_RANGE candidates.
    let end = start.saturating_add(PORT_RANGE - 1);
    (start..=end).find(|port| !is_port_in_use(*port)).ok_or_else(|| i18n::f("Kein freier Port im Bereich {}–{} gefunden.", &[&start, &end]))
}

/// Waits until the server accepts connections; `gave_up` ends the wait early, e.g. when the process has exited.
pub fn wait_for_port(port: u16, timeout: Duration, gave_up: impl Fn() -> Option<String>) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if is_port_in_use(port) {
            return Ok(());
        }
        if let Some(reason) = gave_up() {
            return Err(reason);
        }
        if Instant::now() > deadline {
            return Err(i18n::f("Der Server ist nicht innerhalb von {} Sekunden gestartet.", &[&timeout.as_secs()]));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

pub fn is_same_process(left: Option<u32>, right: Option<u32>) -> bool {
    left.is_some() && left == right
}

pub fn should_kill_superseded_server(previous: Option<u32>, next: Option<u32>) -> bool {
    previous.is_some() && next.is_some() && previous != next
}

pub fn should_restore_previous_server(previous: Option<u32>, attempted: Option<u32>, tracked: Option<u32>) -> bool {
    previous.is_some() && is_same_process(tracked, attempted) && !is_same_process(previous, attempted)
}

/// Tools the server starts, such as the `claude` CLI, are often installed where a GUI process's PATH may not reach.
fn enriched_path() -> OsString {
    let base = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&base).collect();
    let candidates = [dirs::home_dir().map(|home| home.join(".local").join("bin")), dirs::config_dir().map(|roaming| roaming.join("npm"))];
    for candidate in candidates.into_iter().flatten() {
        let known = dirs.iter().any(|dir| dir.as_os_str().eq_ignore_ascii_case(candidate.as_os_str()));
        if !known && candidate.is_dir() {
            dirs.push(candidate);
        }
    }
    std::env::join_paths(dirs).unwrap_or(base)
}

/// Starts the server and returns its PID. Every line it prints goes to `on_line`; `on_exit` runs once with the exit code.
pub fn start_server(
    layout: &ServerLayout,
    port: u16,
    paperclip_home: &Path,
    on_line: Arc<dyn Fn(&str) + Send + Sync>,
    on_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> std::io::Result<u32> {
    let mut child = Command::new(&layout.node)
        .arg(layout.server_dir.join("dist").join("index.js"))
        .current_dir(&layout.cwd)
        .env("PATH", enriched_path())
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("PAPERCLIP_HOME", paperclip_home)
        .env("PAPERCLIP_TEAMS_CATALOG_DIR", layout.teams_catalog_dir())
        .env("PAPERCLIP_MIGRATION_AUTO_APPLY", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    let pid = child.id();

    fn forward(stream: Option<impl Read + Send + 'static>, on_line: Arc<dyn Fn(&str) + Send + Sync>) {
        let Some(stream) = stream else { return };
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = Vec::new();
            while reader.read_until(b'\n', &mut line).is_ok_and(|read| read > 0) {
                on_line(String::from_utf8_lossy(&line).trim_end_matches(['\r', '\n']));
                line.clear();
            }
        });
    }
    forward(child.stdout.take(), on_line.clone());
    forward(child.stderr.take(), on_line);

    std::thread::spawn(move || on_exit(child.wait().ok().and_then(|status| status.code())));
    Ok(pid)
}

/// Ends the process and everything it started (the embedded PostgreSQL), like `taskkill /T /F`.
pub fn kill_process_tree(pid: u32) {
    let killed = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW).status();
    if let Err(e) = killed {
        tracing::warn!("taskkill for pid {pid}: {e}");
    }
}

fn is_node_process(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).trim_start().to_ascii_lowercase().starts_with("\"node.exe\""))
}

fn pid_file(user_data: &Path) -> PathBuf {
    user_data.join(PID_FILE_NAME)
}

pub fn write_pid_file(user_data: &Path, pid: Option<u32>) {
    let path = pid_file(user_data);
    let result = match pid {
        Some(pid) => std::fs::create_dir_all(user_data).and_then(|()| std::fs::write(&path, pid.to_string())),
        None if path.exists() => std::fs::remove_file(&path),
        None => Ok(()),
    };
    if let Err(e) = result {
        tracing::warn!("updating {}: {e}", path.display());
    }
}

/// A PostgreSQL worker can outlive its server when the app was ended hard; it holds the database's shared memory and the next start fails on it.
/// Only processes started from this server's own PostgreSQL binaries are ended.
pub fn kill_stale_postgres(layout: &ServerLayout) {
    const SCRIPT: &str = "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('\\', '/').ToLower().Contains($env:PAPERCLIP_PG_BINARIES) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }";
    let binaries = layout.server_dir.join("node_modules").join("@embedded-postgres").to_string_lossy().replace('\\', "/").to_lowercase();
    let ended = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("PAPERCLIP_PG_BINARIES", binaries)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match ended {
        Ok(output) => {
            let pids = String::from_utf8_lossy(&output.stdout).split_whitespace().collect::<Vec<_>>().join(", ");
            if !pids.is_empty() {
                tracing::info!("ended leftover PostgreSQL processes (pids={pids})");
            }
        }
        Err(e) => tracing::warn!("looking for leftover PostgreSQL processes: {e}"),
    }
}

/// A server left running by a crashed app would hold the database; the PID file names it.
pub fn kill_orphaned_server(user_data: &Path) {
    let orphan = std::fs::read_to_string(pid_file(user_data)).ok().and_then(|raw| raw.trim().parse::<u32>().ok()).filter(|pid| *pid > 0);
    // Windows reuses PIDs, so only a Node.js process is taken for the old server.
    if let Some(pid) = orphan.filter(|pid| is_node_process(*pid)) {
        kill_process_tree(pid);
        tracing::info!("killed orphaned server process (pid={pid})");
    }
    write_pid_file(user_data, None);
}

pub fn archive_dir(log_file: &Path) -> PathBuf {
    log_file.with_file_name("log-archive")
}

fn archive(log_file: &Path, prefix: &str) -> std::io::Result<()> {
    let dir = archive_dir(log_file);
    std::fs::create_dir_all(&dir)?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S-%3fZ");
    std::fs::rename(log_file, dir.join(format!("{prefix}{stamp}.{}", uuid::Uuid::new_v4())))
}

fn prune_archives(log_file: &Path) {
    let Ok(entries) = std::fs::read_dir(archive_dir(log_file)) else { return };
    let mut archives: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(LOG_ARCHIVE_PREFIX) && entry.file_type().is_ok_and(|kind| kind.is_file()))
        .map(|entry| entry.path())
        .collect();
    archives.sort();
    let stale = archives.len().saturating_sub(LOG_ARCHIVE_KEEP);
    for path in archives.into_iter().take(stale) {
        let _ = std::fs::remove_file(path);
    }
}

/// Opens server.log for appending; a log over 20 MB is archived first, and anything that is not a plain file is moved out of the way.
pub fn open_server_log(log_file: &Path) -> std::io::Result<std::fs::File> {
    if let Ok(metadata) = std::fs::symlink_metadata(log_file) {
        if !metadata.is_file() {
            archive(log_file, LOG_UNSAFE_PREFIX)?;
        } else if metadata.len() >= LOG_MAX_BYTES {
            archive(log_file, LOG_ARCHIVE_PREFIX)?;
            prune_archives(log_file);
        }
    }
    if let Some(dir) = log_file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::OpenOptions::new().create(true).append(true).open(log_file)
}

/// `Err` carries what is wrong with the server at `origin`.
pub fn probe_local_server_health(origin: &str, fetch: &dyn Fetch) -> Result<(), String> {
    let response = fetch.get(&format!("{origin}/api/health"), HEALTH_TIMEOUT)?;
    if response.status != 200 {
        return Err(i18n::f("Der Health-Endpunkt antwortete mit HTTP {}.", &[&response.status]));
    }
    if !response.is_json() {
        return Err(i18n::t("Der Health-Endpunkt antwortete nicht mit JSON.").into());
    }
    match response.json()?["status"].as_str() {
        Some("ok") => Ok(()),
        status => Err(i18n::f("Der Health-Endpunkt meldet den Status „{}“.", &[&status.unwrap_or("unknown")])),
    }
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use serde_json::json;

    use super::*;
    use crate::connection::http::testing::{FakeFetch, json_response};

    #[test]
    fn processes_are_matched_by_pid() {
        assert!(is_same_process(Some(101), Some(101)));
        assert!(!is_same_process(Some(101), Some(202)));
        assert!(!is_same_process(Some(101), None));
        assert!(!is_same_process(None, None));
    }

    #[test]
    fn the_previous_server_is_killed_after_a_swap_and_restored_after_a_failed_one() {
        assert!(should_kill_superseded_server(Some(101), Some(202)));
        assert!(!should_kill_superseded_server(Some(101), Some(101)));
        assert!(!should_kill_superseded_server(None, Some(202)));

        assert!(should_restore_previous_server(Some(101), Some(202), Some(202)));
        assert!(!should_restore_previous_server(None, Some(202), Some(202)));
        assert!(!should_restore_previous_server(Some(101), Some(202), Some(303)));
    }

    #[test]
    fn a_listening_port_is_in_use_and_the_search_skips_it() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        // On a busy machine the first connection can take longer than the check waits.
        assert!((0..10).any(|_| is_port_in_use(port)));
        assert_ne!(find_free_port(port).ok(), Some(port));
        assert!(find_free_port(u16::MAX).is_ok_and(|free| free == u16::MAX) || is_port_in_use(u16::MAX));
        assert!(wait_for_port(port, Duration::from_secs(1), || None).is_ok());
        drop(listener);
        assert!(!is_port_in_use(port));
        assert_eq!(wait_for_port(port, Duration::from_secs(5), || Some("exited".into())).unwrap_err(), "exited");
    }

    #[test]
    fn the_health_probe_accepts_only_an_ok_payload() {
        let probe = |response| probe_local_server_health("http://127.0.0.1:3100", &FakeFetch::new(vec![response]));
        assert_eq!(probe(json_response(json!({ "status": "ok" }), 200)), Ok(()));
        assert!(probe(json_response(json!({ "status": "starting" }), 200)).unwrap_err().contains("starting"));
        assert!(probe(json_response(json!({ "status": "ok" }), 503)).unwrap_err().contains("503"));
        assert!(probe(Err("socket hang up".into())).unwrap_err().contains("socket hang up"));
    }

    #[test]
    fn a_large_log_is_archived_and_only_the_newest_archives_are_kept() {
        let dir = std::env::temp_dir().join(format!("paperclipdesk-log-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("server.log");

        std::fs::write(&log, "small").unwrap();
        drop(open_server_log(&log).unwrap());
        assert!(!archive_dir(&log).exists());

        for _ in 0..LOG_ARCHIVE_KEEP + 2 {
            let file = std::fs::File::create(&log).unwrap();
            file.set_len(LOG_MAX_BYTES).unwrap();
            drop(file);
            drop(open_server_log(&log).unwrap());
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(std::fs::read_dir(archive_dir(&log)).unwrap().count(), LOG_ARCHIVE_KEEP);
        assert_eq!(std::fs::metadata(&log).unwrap().len(), 0);

        std::fs::remove_file(&log).unwrap();
        std::fs::create_dir(&log).unwrap();
        drop(open_server_log(&log).unwrap());
        assert!(std::fs::read_dir(archive_dir(&log)).unwrap().flatten().any(|entry| entry.file_name().to_string_lossy().starts_with(LOG_UNSAFE_PREFIX)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_pid_file_is_written_and_removed() {
        let dir = std::env::temp_dir().join(format!("paperclipdesk-pid-{}", uuid::Uuid::new_v4()));
        write_pid_file(&dir, Some(4242));
        assert_eq!(std::fs::read_to_string(pid_file(&dir)).unwrap(), "4242");
        write_pid_file(&dir, None);
        assert!(!pid_file(&dir).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
