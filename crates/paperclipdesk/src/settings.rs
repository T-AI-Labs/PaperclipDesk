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
    /// A language code, or "System" for the language Windows runs in.
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { color_scheme: "system".into(), theme: "klar".into(), accent: "default".into(), show_logs: true, clear_logs_on_exit: false, check_updates_on_start: true, language: "System".into() }
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
