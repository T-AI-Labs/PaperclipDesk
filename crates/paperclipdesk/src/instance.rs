use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::i18n;

const INSTANCE_ID_ENV: &str = "PAPERCLIP_INSTANCE_ID";
const DEFAULT_INSTANCE: &str = "default";
/// The embedded PostgreSQL lets go of its files a moment after it was ended.
const REMOVE_ATTEMPTS: u32 = 10;
const REMOVE_RETRY: Duration = Duration::from_millis(500);

/// The two files the server reads its configuration from; both are optional.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ConfigFile {
    Config,
    Env,
}

impl ConfigFile {
    const ALL: [Self; 2] = [Self::Config, Self::Env];

    fn name(self) -> &'static str {
        match self {
            Self::Config => "config.json",
            Self::Env => ".env",
        }
    }
}

/// Where the local server keeps its database, companies, secrets and configuration.
pub fn instance_dir(paperclip_home: &Path) -> PathBuf {
    let id = std::env::var(INSTANCE_ID_ENV).ok().filter(|id| !id.trim().is_empty()).unwrap_or_else(|| DEFAULT_INSTANCE.into());
    paperclip_home.join("instances").join(id)
}

pub fn config_path(instance: &Path, file: ConfigFile) -> PathBuf {
    instance.join(file.name())
}

/// A file that does not exist yet reads as empty.
pub fn read_config(instance: &Path, file: ConfigFile) -> String {
    std::fs::read_to_string(config_path(instance, file)).unwrap_or_default()
}

/// Empty content removes the file, so the server falls back to its defaults.
pub fn write_config(instance: &Path, file: ConfigFile, content: &str) -> Result<(), String> {
    let path = config_path(instance, file);
    let failed = |e: std::io::Error| format!("{}: {e}", path.display());
    if content.trim().is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(failed(e)),
            _ => Ok(()),
        };
    }
    if file == ConfigFile::Config {
        serde_json::from_str::<serde_json::Value>(content).map_err(|e| i18n::f("config.json ist kein gültiges JSON: {}", &[&e]))?;
    }
    std::fs::create_dir_all(instance).map_err(failed)?;
    std::fs::write(&path, content).map_err(failed)
}

/// Empties the instance. `backup` moves the old data aside under the returned path instead of deleting it;
/// `keep_config` carries config.json and .env over.
pub fn reset(instance: &Path, keep_config: bool, backup: bool, stamp: &str) -> Result<Option<PathBuf>, String> {
    if !instance.exists() {
        return Ok(None);
    }
    let failed = |e: std::io::Error| i18n::f("Die Server-Daten ließen sich nicht zurücksetzen: {}", &[&e]);
    let kept: Vec<(ConfigFile, String)> = ConfigFile::ALL.into_iter().filter(|_| keep_config).map(|file| (file, read_config(instance, file))).collect();

    let moved = backup.then(|| {
        let name = instance.file_name().unwrap_or_default().to_string_lossy();
        instance.with_file_name(format!("{name}.backup-{stamp}"))
    });
    retry(|| match &moved {
        Some(target) => std::fs::rename(instance, target),
        None => std::fs::remove_dir_all(instance),
    })
    .map_err(failed)?;

    for (file, content) in kept {
        write_config(instance, file, &content)?;
    }
    Ok(moved)
}

fn retry(action: impl Fn() -> std::io::Result<()>) -> std::io::Result<()> {
    let mut attempt = 1;
    loop {
        match action() {
            Err(_) if attempt < REMOVE_ATTEMPTS => {
                attempt += 1;
                std::thread::sleep(REMOVE_RETRY);
            }
            done => return done,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_instance() -> PathBuf {
        let instance = std::env::temp_dir().join(format!("paperclip-instance-{}", uuid::Uuid::new_v4())).join("default");
        std::fs::create_dir_all(instance.join("db")).unwrap();
        std::fs::write(instance.join("db").join("PG_VERSION"), "17").unwrap();
        instance
    }

    #[test]
    fn config_must_be_json_and_empty_content_removes_the_file() {
        let instance = temp_instance();
        assert!(write_config(&instance, ConfigFile::Config, "{ not json").is_err());
        write_config(&instance, ConfigFile::Config, r#"{"server":{"port":3200}}"#).unwrap();
        write_config(&instance, ConfigFile::Env, "PAPERCLIP_PUBLIC_URL=http://localhost").unwrap();
        assert_eq!(read_config(&instance, ConfigFile::Env), "PAPERCLIP_PUBLIC_URL=http://localhost");

        write_config(&instance, ConfigFile::Config, "  ").unwrap();
        assert!(!config_path(&instance, ConfigFile::Config).exists());
        assert_eq!(read_config(&instance, ConfigFile::Config), "");
        std::fs::remove_dir_all(instance.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_reset_keeps_the_configuration_and_moves_the_data_aside() {
        let instance = temp_instance();
        write_config(&instance, ConfigFile::Config, "{}").unwrap();

        let backup = reset(&instance, true, true, "20261011-120000").unwrap().unwrap();
        assert!(backup.join("db").join("PG_VERSION").is_file());
        assert!(!instance.join("db").exists());
        assert_eq!(read_config(&instance, ConfigFile::Config), "{}");

        assert_eq!(reset(&instance, false, false, "x").unwrap(), None);
        assert!(!instance.exists());
        assert_eq!(reset(&instance, false, false, "x").unwrap(), None);
        std::fs::remove_dir_all(instance.parent().unwrap()).unwrap();
    }
}
