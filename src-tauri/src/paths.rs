use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

pub const USER_DATA_DIR_ENV: &str = "PAPERCLIPDESK_USER_DATA_DIR";
pub const PAPERCLIP_HOME_ENV: &str = "PAPERCLIP_HOME";
pub const REQUIRE_ISOLATED_DATA_ENV: &str = "PAPERCLIPDESK_REQUIRE_ISOLATED_DATA";

const APP_DIR: &str = "Paperclip";

/// The environment variables that move the app's data, e.g. for a test run next to a real installation.
#[derive(Default, Clone)]
pub struct DataEnv {
    pub user_data_dir: Option<String>,
    pub paperclip_home: Option<String>,
    pub require_isolated_data: bool,
}

impl DataEnv {
    pub fn from_process() -> Self {
        Self {
            user_data_dir: std::env::var(USER_DATA_DIR_ENV).ok(),
            paperclip_home: std::env::var(PAPERCLIP_HOME_ENV).ok(),
            require_isolated_data: std::env::var(REQUIRE_ISOLATED_DATA_ENV).is_ok_and(|value| value == "1"),
        }
    }
}

/// Where the app keeps connections, logs, the PID file and, by default, the server's data.
#[derive(Clone, Debug)]
pub struct DataPaths {
    pub user_data: PathBuf,
    pub paperclip_home: PathBuf,
    pub webview_data: PathBuf,
}

impl DataPaths {
    pub fn resolve(env: &DataEnv) -> Result<Self> {
        let home = dirs::home_dir().unwrap_or_default();
        let roaming = dirs::config_dir().unwrap_or_else(|| home.join("AppData").join("Roaming"));
        let local = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData").join("Local"));

        let user_data_override = absolute_path(USER_DATA_DIR_ENV, env.user_data_dir.as_deref())?;
        let user_data = user_data_override.clone().unwrap_or_else(|| roaming.join(APP_DIR));
        let paperclip_home = paperclip_home(env, &home, &user_data, |path| path.exists())?;
        assert_isolated(env, &user_data, &paperclip_home, &production_data_paths(&home, &roaming))?;
        // Browser caches are large and machine-bound, so they stay out of the roaming profile.
        let webview_data = user_data_override.unwrap_or_else(|| local.join(APP_DIR)).join("webview");
        Ok(Self { user_data, paperclip_home, webview_data })
    }

    /// Downloaded server packages, one folder per version, next to the browser profiles.
    pub fn server_packages(&self) -> PathBuf {
        self.webview_data.with_file_name("app-server")
    }

    pub fn log_dir(&self) -> PathBuf {
        self.user_data.join("logs")
    }

    pub fn server_log(&self) -> PathBuf {
        self.user_data.join("server.log")
    }
}

fn absolute_path(name: &str, value: Option<&str>) -> Result<Option<PathBuf>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        bail!("{name} must be an absolute path.");
    }
    Ok(Some(path))
}

/// An existing CLI installation in `~/.paperclip` is shared; otherwise the server's data lives with the app's.
pub fn paperclip_home(env: &DataEnv, home: &Path, user_data: &Path, exists: impl Fn(&Path) -> bool) -> Result<PathBuf> {
    if let Some(overridden) = absolute_path(PAPERCLIP_HOME_ENV, env.paperclip_home.as_deref())? {
        return Ok(overridden);
    }
    let default_home = home.join(".paperclip");
    if !home.as_os_str().is_empty() && exists(&default_home.join("instances").join("default").join("db")) {
        return Ok(default_home);
    }
    Ok(user_data.to_owned())
}

pub fn production_data_paths(home: &Path, roaming: &Path) -> Vec<PathBuf> {
    if home.as_os_str().is_empty() {
        return Vec::new();
    }
    vec![roaming.join(APP_DIR), home.join(".paperclip")]
}

/// With isolation required, both data roots must be given explicitly and neither may be a real installation's.
pub fn assert_isolated(env: &DataEnv, user_data: &Path, paperclip_home: &Path, production_paths: &[PathBuf]) -> Result<()> {
    if !env.require_isolated_data {
        return Ok(());
    }
    let user_data_override = absolute_path(USER_DATA_DIR_ENV, env.user_data_dir.as_deref())?;
    let paperclip_home_override = absolute_path(PAPERCLIP_HOME_ENV, env.paperclip_home.as_deref())?;
    let (Some(user_data_override), Some(paperclip_home_override)) = (user_data_override, paperclip_home_override) else {
        bail!("{REQUIRE_ISOLATED_DATA_ENV}=1 requires both {USER_DATA_DIR_ENV} and {PAPERCLIP_HOME_ENV} to be absolute paths.");
    };
    if user_data != user_data_override {
        bail!("{REQUIRE_ISOLATED_DATA_ENV}=1 expected userData to be {}, got {}", user_data_override.display(), user_data.display());
    }
    if paperclip_home != paperclip_home_override {
        bail!("{REQUIRE_ISOLATED_DATA_ENV}=1 expected {PAPERCLIP_HOME_ENV} to be {}, got {}", paperclip_home_override.display(), paperclip_home.display());
    }
    for production in production_paths {
        if user_data == production || paperclip_home == production {
            bail!("{REQUIRE_ISOLATED_DATA_ENV}=1 refused to use production Paperclip data path: {}", production.display());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = r"C:\Users\example";
    const ROAMING: &str = r"C:\Users\example\AppData\Roaming";
    const USER_DATA: &str = r"C:\Users\example\AppData\Roaming\Paperclip";

    fn isolated(user_data: &str, paperclip_home: &str) -> DataEnv {
        DataEnv { user_data_dir: Some(user_data.into()), paperclip_home: Some(paperclip_home.into()), require_isolated_data: true }
    }

    #[test]
    fn path_overrides_must_be_absolute() {
        let env = DataEnv { paperclip_home: Some(r"relative\path".into()), ..Default::default() };
        let error = paperclip_home(&env, Path::new(HOME), Path::new(USER_DATA), |_| false).unwrap_err();
        assert!(error.to_string().contains("absolute path"));
    }

    #[test]
    fn paperclip_home_override_wins_over_an_existing_cli_home() {
        let env = DataEnv { paperclip_home: Some(r"C:\tmp\paperclip-home".into()), ..Default::default() };
        assert_eq!(paperclip_home(&env, Path::new(HOME), Path::new(USER_DATA), |_| true).unwrap(), Path::new(r"C:\tmp\paperclip-home"));
    }

    #[test]
    fn an_existing_cli_home_is_shared_and_the_user_data_folder_is_the_fallback() {
        let env = DataEnv::default();
        let cli_db = Path::new(HOME).join(".paperclip").join("instances").join("default").join("db");
        assert_eq!(paperclip_home(&env, Path::new(HOME), Path::new(USER_DATA), |path| path == cli_db).unwrap(), Path::new(HOME).join(".paperclip"));
        assert_eq!(paperclip_home(&env, Path::new(HOME), Path::new(USER_DATA), |_| false).unwrap(), Path::new(USER_DATA));
    }

    #[test]
    fn isolated_data_needs_both_roots_away_from_a_real_installation() {
        let production = production_data_paths(Path::new(HOME), Path::new(ROAMING));
        assert_eq!(production, [PathBuf::from(USER_DATA), Path::new(HOME).join(".paperclip")]);

        let only_flag = DataEnv { require_isolated_data: true, ..Default::default() };
        let error = assert_isolated(&only_flag, Path::new(r"C:\tmp\user-data"), Path::new(r"C:\tmp\home"), &production).unwrap_err();
        assert!(error.to_string().contains("requires both"));

        let error = assert_isolated(&isolated(USER_DATA, r"C:\tmp\home"), Path::new(USER_DATA), Path::new(r"C:\tmp\home"), &production).unwrap_err();
        assert!(error.to_string().contains("refused to use production Paperclip data path"));

        let env = isolated(r"C:\tmp\smoke\user-data", r"C:\tmp\smoke\home");
        let error = assert_isolated(&env, Path::new(r"C:\tmp\other"), Path::new(r"C:\tmp\smoke\home"), &production).unwrap_err();
        assert!(error.to_string().contains("expected userData"));
        assert!(assert_isolated(&env, Path::new(r"C:\tmp\smoke\user-data"), Path::new(r"C:\tmp\smoke\home"), &production).is_ok());
    }
}
