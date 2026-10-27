use std::cell::Cell;
use std::collections::VecDeque;
use std::fmt::Debug;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

use crate::client::LAUNCHER_LABEL;

const EVENT: &str = "launcher:alert";
/// The shell asks for these once it loaded, so errors from before it existed reach the bell too.
const KEPT: usize = 50;
/// The same text again within this time is the same trouble, not a new one.
const QUIET_MS: i64 = 60_000;
/// A message longer than this is cut; the log has all of it.
const LONGEST: usize = 300;

/// Something that went wrong: an error pops up, unless the user turned that off, and a warning only goes into the bell.
#[derive(Serialize, Clone)]
pub struct Alert {
    text: String,
    at: i64,
    error: bool,
}

static HANDLE: OnceLock<AppHandle> = OnceLock::new();
static RECENT: Mutex<VecDeque<Alert>> = Mutex::new(VecDeque::new());

thread_local! {
    /// Set while an alert is sent, so a failure to send it, which is logged too, does not raise another.
    static RAISING: Cell<bool> = const { Cell::new(false) };
}

/// Alerts go to the shell from now on; those raised before wait in `recent`.
pub fn connect(handle: AppHandle) {
    let _ = HANDLE.set(handle);
}

pub fn recent() -> Vec<Alert> {
    RECENT.lock().unwrap().iter().cloned().collect()
}

pub fn raise(text: &str, error: bool) {
    if RAISING.with(|raising| raising.replace(true)) {
        return;
    }
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let first = lines.next().unwrap_or_default();
    // A crash names its cause further down, below the stack trace.
    let first = match lines.find_map(|line| line.split_once("Error: ").map(|(_, cause)| cause)) {
        Some(cause) if !first.contains(cause) => format!("{first} {cause}"),
        _ => first.to_owned(),
    };
    let text = match first.char_indices().nth(LONGEST) {
        Some((cut, _)) => format!("{} …", &first[..cut]),
        None => first,
    };
    let now = chrono::Utc::now().timestamp_millis();
    let alert = {
        let mut recent = RECENT.lock().unwrap();
        if text.is_empty() || recent.iter().any(|known| known.text == text && now - known.at < QUIET_MS) {
            None
        } else {
            let alert = Alert { text, at: now, error };
            recent.push_back(alert.clone());
            while recent.len() > KEPT {
                recent.pop_front();
            }
            Some(alert)
        }
    };
    if let (Some(alert), Some(handle)) = (alert, HANDLE.get()) {
        let _ = handle.emit_to(LAUNCHER_LABEL, EVENT, alert);
    }
    RAISING.with(|raising| raising.set(false));
}

/// What a line of the server's output says went wrong: Paperclip logs JSON, with level 50 for an error and 60 for a fatal one.
pub fn server_error(line: &str) -> Option<String> {
    let entry: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if entry["level"].as_u64()? < 50 {
        return None;
    }
    let message = entry["msg"].as_str().unwrap_or_default();
    Some(match entry["err"]["message"].as_str() {
        Some(cause) if !message.is_empty() => format!("Paperclip: {message}: {cause}"),
        Some(cause) => format!("Paperclip: {cause}"),
        None => format!("Paperclip: {message}"),
    })
}

/// Raises the app's own errors and warnings; those of the libraries it uses stay in the log.
pub struct FromLog;

impl<S: Subscriber> Layer<S> for FromLog {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let level = *event.metadata().level();
        if level > Level::WARN || !event.metadata().target().starts_with(env!("CARGO_CRATE_NAME")) {
            return;
        }
        let mut message = Message(String::new());
        event.record(&mut message);
        raise(&message.0, level == Level::ERROR);
    }
}

struct Message(String);

impl Visit for Message {
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        if field.name() == "message" {
            self.0 = format!("{value:?}");
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.0 = value.to_owned();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_errors_of_the_server_are_alerts() {
        assert_eq!(server_error(r#"{"level":50,"msg":"request failed","err":{"message":"connection refused"}}"#).as_deref(), Some("Paperclip: request failed: connection refused"));
        assert_eq!(server_error(r#"{"level":60,"msg":"database gone"}"#).as_deref(), Some("Paperclip: database gone"));
        assert_eq!(server_error(r#"{"level":40,"msg":"Removing stale embedded PostgreSQL lock file"}"#), None);
        assert_eq!(server_error("Server listening on 3100"), None);
    }

    #[test]
    fn an_alert_is_its_first_line_and_a_repeat_is_left_out() {
        raise("first line of a test alert\nthe rest", true);
        raise("first line of a test alert", true);
        let known: Vec<_> = recent().into_iter().filter(|alert| alert.text == "first line of a test alert").collect();
        assert_eq!(known.len(), 1);
    }

    #[test]
    fn a_crash_names_its_cause() {
        raise("The test server stopped while starting (exit code 1).\n\n    ^\nError: Cannot find module './worker.js'\nRequire stack:", true);
        assert!(recent().iter().any(|alert| alert.text == "The test server stopped while starting (exit code 1). Cannot find module './worker.js'"));
    }
}
