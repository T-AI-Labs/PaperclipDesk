use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "client-settings.json";

/// How the app's own window looks; everything about connections lives in connections.json.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(default)]
pub struct Settings {
    pub color_scheme: String,
    pub theme: String,
    pub accent: String,
    pub show_logs: bool,
    /// Empties the app's and the server's logs when the app exits.
    pub clear_logs_on_exit: bool,
    pub check_updates_on_start: bool,
    /// Shows the welcome page at every start; without it, only a start with nothing chosen to open shows it.
    pub show_welcome: bool,
    /// Whether the menu bar shows, above Paperclip and above the app's own pages.
    pub show_menu_bar: bool,
    /// Whether the menu bar shows the path of the Paperclip page in front, as a field to go elsewhere.
    pub show_address_bar: bool,
    /// Whether the app has an icon in the notification area of the taskbar.
    pub show_tray: bool,
    /// The key of each action that has one, e.g. "view.fullscreen" → "F11".
    pub shortcuts: BTreeMap<String, String>,
    /// A language code, or "System" for the language Windows runs in.
    pub language: String,
    /// The newer Paperclip server the user installed; none runs the one this build is tested with. Only `upgrade_server` sets it.
    pub server_version: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { color_scheme: "system".into(), theme: "klar".into(), accent: "default".into(), show_logs: true, clear_logs_on_exit: false, check_updates_on_start: true, show_welcome: false, show_menu_bar: true, show_address_bar: false, show_tray: true, shortcuts: crate::shortcuts::defaults(), language: "System".into(), server_version: None }
    }
}

pub fn file_path(user_data: &Path) -> PathBuf {
    user_data.join(FILE_NAME)
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(settings).expect("settings serialize"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_partial_files_fall_back_to_the_defaults() {
        let dir = std::env::temp_dir().join(format!("paperclipdesk-settings-{}", uuid::Uuid::new_v4()));
        let path = file_path(&dir);
        assert_eq!(load(&path), Settings::default());

        save(&path, &Settings { theme: "nord".into(), ..Default::default() }).unwrap();
        assert_eq!(load(&path).theme, "nord");

        std::fs::write(&path, r#"{ "accent": "teal" }"#).unwrap();
        assert_eq!(load(&path), Settings { accent: "teal".into(), ..Default::default() });
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
