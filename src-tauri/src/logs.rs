use crate::i18n;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::paths::DataPaths;

const LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LogFile {
    pub name: String,
    pub size: u64,
    /// Last write, milliseconds since the Unix epoch.
    pub modified_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct LogTail {
    pub files: Vec<LogFile>,
    pub file: Option<String>,
    pub lines: Vec<String>,
}

fn describe(path: &Path) -> Option<LogFile> {
    let meta = path.metadata().ok().filter(|m| m.is_file())?;
    let modified_ms = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    Some(LogFile { name: path.file_name()?.to_string_lossy().into_owned(), size: meta.len(), modified_ms })
}

/// The server's log first, then the app's own log files, newest first.
fn log_files(paths: &DataPaths) -> Vec<(LogFile, PathBuf)> {
    let mut own: Vec<(LogFile, PathBuf)> =
        std::fs::read_dir(paths.log_dir()).into_iter().flatten().flatten().filter_map(|entry| Some((describe(&entry.path())?, entry.path()))).collect();
    own.sort_by(|(a, _), (b, _)| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.name.cmp(&b.name)));
    let server = paths.server_log();
    describe(&server).map(|file| (file, server)).into_iter().chain(own).collect()
}

/// The last `lines` lines of one log file.
fn tail(path: &Path, lines: usize) -> std::io::Result<Vec<String>> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    // A cut into the middle of the file starts inside a line; drop that partial line.
    let text = if start > 0 { text.split_once('\n').map_or("", |(_, rest)| rest) } else { &text };
    let all: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    Ok(all[all.len().saturating_sub(lines)..].iter().map(|line| line.to_string()).collect())
}

/// `name` must be one of the listed files, so nothing outside the log folders is read.
pub fn log_tail(paths: &DataPaths, name: Option<String>, lines: usize) -> Result<LogTail, String> {
    let sources = log_files(paths);
    let file = name.or_else(|| sources.first().map(|(file, _)| file.name.clone()));
    let lines = match &file {
        Some(name) => {
            let (_, path) = sources.iter().find(|(file, _)| file.name == *name).ok_or_else(|| i18n::f("Keine Protokolldatei „{}“", &[&name]))?;
            tail(path, lines).map_err(|e| e.to_string())?
        }
        None => Vec::new(),
    };
    Ok(LogTail { files: sources.into_iter().map(|(file, _)| file).collect(), file, lines })
}

/// The app and the server keep their current log open for appending, so a log is emptied rather than removed.
fn empty(path: &Path) -> std::io::Result<()> {
    std::fs::OpenOptions::new().write(true).open(path)?.set_len(0)
}

/// Empties one log file; `name` must be one of the listed files.
pub fn clear(paths: &DataPaths, name: &str) -> Result<(), String> {
    let sources = log_files(paths);
    let (_, path) = sources.iter().find(|(file, _)| file.name == name).ok_or_else(|| i18n::f("Keine Protokolldatei „{}“", &[&name]))?;
    empty(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Empties the logs still being written, and removes the app's older daily logs and the archived server logs.
pub fn clear_all(paths: &DataPaths) {
    let server = paths.server_log();
    let mut current = vec![server.clone()];
    for (index, (_, path)) in log_files(paths).into_iter().filter(|(_, path)| *path != server).enumerate() {
        if index == 0 {
            current.push(path);
        } else if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!("removing {}: {e}", path.display());
        }
    }
    for path in current.iter().filter(|path| path.is_file()) {
        if let Err(e) = empty(path) {
            tracing::warn!("emptying {}: {e}", path.display());
        }
    }
    let _ = std::fs::remove_dir_all(crate::server::archive_dir(&server));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_the_server_log_first_and_reads_only_listed_files() {
        let root = std::env::temp_dir().join(format!("paperclipdesk-logs-{}", uuid::Uuid::new_v4()));
        let paths = DataPaths { user_data: root.clone(), paperclip_home: root.clone(), webview_data: root.join("webview") };
        std::fs::create_dir_all(paths.log_dir()).unwrap();
        assert_eq!(log_tail(&paths, None, 10).unwrap().file, None);

        std::fs::write(paths.log_dir().join("paperclipdesk.log"), "app line\n").unwrap();
        std::fs::write(paths.server_log(), "one\n\ntwo\nthree\n").unwrap();
        let latest = log_tail(&paths, None, 2).unwrap();
        assert_eq!(latest.file.as_deref(), Some("server.log"));
        assert_eq!(latest.lines, ["two", "three"]);
        assert_eq!(latest.files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["server.log", "paperclipdesk.log"]);

        assert_eq!(log_tail(&paths, Some("paperclipdesk.log".into()), 10).unwrap().lines, ["app line"]);
        assert!(log_tail(&paths, Some(r"..\connections.json".into()), 10).is_err());

        assert!(clear(&paths, r"..\connections.json").is_err());
        clear(&paths, "server.log").unwrap();
        assert!(log_tail(&paths, Some("server.log".into()), 10).unwrap().lines.is_empty());

        std::fs::write(paths.log_dir().join("paperclipdesk.older.log"), "old\n").unwrap();
        std::fs::File::options().write(true).open(paths.log_dir().join("paperclipdesk.older.log")).unwrap().set_modified(UNIX_EPOCH).unwrap();
        clear_all(&paths);
        assert_eq!(log_tail(&paths, None, 10).unwrap().files.iter().map(|f| (f.name.as_str(), f.size)).collect::<Vec<_>>(), [("server.log", 0), ("paperclipdesk.log", 0)]);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
