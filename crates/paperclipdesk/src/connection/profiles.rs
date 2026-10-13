use crate::i18n;
use std::path::{Path, PathBuf};

use serde_json::Value;
use url::Url;

use super::types::{
    CONNECTIONS_FILE_NAME, CONNECTIONS_FILE_VERSION, ConnectionHealth, ConnectionMode, ConnectionProfile, ConnectionState, DeploymentMode, FailureReason, LOCAL_PROFILE_ID,
    PersistedConnectionsFile, RemotePreflightResult, SessionState,
};
use super::validate::normalize_remote_url;

const INSECURE_HTTP_NOT_CONFIRMED: &str = "HTTP-Remotes erfordern die Bestätigung, dass du eine unsichere Verbindung zulassen möchtest.";
const EPOCH: &str = "1970-01-01T00:00:00.000Z";

pub fn connections_file_path(user_data: &Path) -> PathBuf {
    user_data.join(CONNECTIONS_FILE_NAME)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn default_state() -> ConnectionState {
    ConnectionState {
        active_profile_id: None,
        always_show_chooser: true,
        auto_connect_last_profile: false,
        local_profile_name: "Local".into(),
        local_last_connected_at: None,
        local_last_health: Some(ConnectionHealth::Healthy),
    }
}

fn default_file() -> PersistedConnectionsFile {
    PersistedConnectionsFile { version: CONNECTIONS_FILE_VERSION, state: default_state(), remote_profiles: Vec::new() }
}

#[derive(Default)]
pub struct RemoteProfileInput {
    pub profile_id: Option<String>,
    pub name: Option<String>,
    pub remote_url: String,
    pub allow_insecure_http: bool,
}

/// The saved connections and the startup preference, kept in connections.json in the user data folder.
pub struct ConnectionStore {
    file_path: PathBuf,
    cache: PersistedConnectionsFile,
}

impl ConnectionStore {
    pub fn open(file_path: PathBuf) -> Self {
        let cache = std::fs::read_to_string(&file_path).ok().and_then(|raw| serde_json::from_str::<Value>(&raw).ok()).map(|raw| sanitize_file(&raw)).unwrap_or_else(default_file);
        Self { file_path, cache }
    }

    pub fn state(&self) -> &ConnectionState {
        &self.cache.state
    }

    pub fn list_profiles(&self) -> Vec<ConnectionProfile> {
        std::iter::once(local_profile(&self.cache.state)).chain(self.cache.remote_profiles.iter().cloned()).collect()
    }

    pub fn profile(&self, profile_id: &str) -> Option<ConnectionProfile> {
        if profile_id == LOCAL_PROFILE_ID {
            return Some(local_profile(&self.cache.state));
        }
        self.cache.remote_profiles.iter().find(|profile| profile.id == profile_id).cloned()
    }

    /// The profile to connect to without asking; `None` shows the chooser.
    pub fn startup_profile_id(&self) -> Option<String> {
        let state = &self.cache.state;
        if state.always_show_chooser || !state.auto_connect_last_profile {
            return None;
        }
        let active = state.active_profile_id.as_deref()?;
        if active == LOCAL_PROFILE_ID {
            return Some(active.to_owned());
        }
        self.cache
            .remote_profiles
            .iter()
            .any(|profile| profile.id == active && (!profile.remote_url.as_deref().is_some_and(|url| url.starts_with("http://")) || profile.allow_insecure_http == Some(true)))
            .then(|| active.to_owned())
    }

    pub fn save_remote_profile(&mut self, input: RemoteProfileInput, now: &str) -> Result<ConnectionProfile, String> {
        let normalized = normalize_remote_url(&input.remote_url)?;
        if normalized.insecure_transport && !input.allow_insecure_http {
            return Err(i18n::t(INSECURE_HTTP_NOT_CONFIRMED).into());
        }
        let name = profile_name(input.name.as_deref(), &normalized.origin);
        let allow_insecure_http = normalized.insecure_transport.then_some(true);

        let existing = input.profile_id.and_then(|id| self.cache.remote_profiles.iter_mut().find(|profile| profile.id == id));
        let saved = if let Some(profile) = existing {
            profile.name = name;
            profile.remote_url = Some(normalized.normalized_url);
            profile.allow_insecure_http = allow_insecure_http;
            profile.updated_at = now.to_owned();
            profile.clone()
        } else {
            let profile = ConnectionProfile {
                id: uuid::Uuid::new_v4().to_string(),
                name,
                mode: ConnectionMode::RemoteExisting,
                remote_url: Some(normalized.normalized_url),
                allow_insecure_http,
                created_at: now.to_owned(),
                updated_at: now.to_owned(),
                last_connected_at: None,
                last_health: Some(ConnectionHealth::Unknown),
                last_deployment_mode: None,
                last_session_state: Some(SessionState::Unknown),
            };
            self.cache.remote_profiles.push(profile.clone());
            profile
        };
        self.persist();
        Ok(saved)
    }

    pub fn duplicate_remote_profile(&mut self, profile_id: &str, now: &str) -> Result<ConnectionProfile, String> {
        let existing = self.remote_profile_mut(profile_id)?.clone();
        let duplicate = ConnectionProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: i18n::f("{} (Kopie)", &[&existing.name]),
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
            last_connected_at: None,
            ..existing
        };
        self.cache.remote_profiles.push(duplicate.clone());
        self.persist();
        Ok(duplicate)
    }

    pub fn delete_remote_profile(&mut self, profile_id: &str) {
        let before = self.cache.remote_profiles.len();
        self.cache.remote_profiles.retain(|profile| profile.id != profile_id);
        if before == self.cache.remote_profiles.len() {
            return;
        }
        if self.cache.state.active_profile_id.as_deref() == Some(profile_id) {
            self.cache.state.active_profile_id = None;
        }
        self.persist();
    }

    pub fn set_always_show_chooser(&mut self, value: bool) {
        self.cache.state.always_show_chooser = value;
        if value {
            self.cache.state.auto_connect_last_profile = false;
        }
        self.persist();
    }

    pub fn set_remembered_profile(&mut self, profile_id: Option<&str>, remember_choice: bool) {
        self.cache.state.active_profile_id = profile_id.map(str::to_owned);
        self.cache.state.auto_connect_last_profile = remember_choice;
        self.cache.state.always_show_chooser = !remember_choice;
        self.persist();
    }

    pub fn record_local_connection(&mut self, now: &str) {
        self.cache.state.active_profile_id = Some(LOCAL_PROFILE_ID.to_owned());
        self.cache.state.local_last_connected_at = Some(now.to_owned());
        self.cache.state.local_last_health = Some(ConnectionHealth::Healthy);
        self.persist();
    }

    pub fn record_remote_connection(&mut self, profile_id: &str, result: &RemotePreflightResult, now: &str) -> Result<(), String> {
        let profile = self.remote_profile_mut(profile_id)?;
        profile.last_connected_at = Some(now.to_owned());
        apply_result(profile, result, now);
        self.cache.state.active_profile_id = Some(profile_id.to_owned());
        self.persist();
        Ok(())
    }

    pub fn record_remote_health(&mut self, profile_id: &str, result: &RemotePreflightResult, now: &str) -> Result<(), String> {
        apply_result(self.remote_profile_mut(profile_id)?, result, now);
        self.persist();
        Ok(())
    }

    pub fn recent_remote_profiles(&self, limit: usize) -> Vec<ConnectionProfile> {
        let mut profiles = self.cache.remote_profiles.clone();
        profiles.sort_by(|left, right| right.last_connected_at.as_ref().unwrap_or(&right.updated_at).cmp(left.last_connected_at.as_ref().unwrap_or(&left.updated_at)));
        profiles.truncate(limit);
        profiles
    }

    fn remote_profile_mut(&mut self, profile_id: &str) -> Result<&mut ConnectionProfile, String> {
        self.cache.remote_profiles.iter_mut().find(|profile| profile.id == profile_id).ok_or_else(|| i18n::f("Unbekanntes Remote-Profil: {}", &[&profile_id]))
    }

    fn persist(&self) {
        let written = self.file_path.parent().map_or(Ok(()), std::fs::create_dir_all).and_then(|()| {
            let json = serde_json::to_string_pretty(&self.cache).expect("connections serialize");
            std::fs::write(&self.file_path, json)
        });
        if let Err(e) = written {
            tracing::warn!("saving {}: {e}", self.file_path.display());
        }
    }
}

fn apply_result(profile: &mut ConnectionProfile, result: &RemotePreflightResult, now: &str) {
    profile.updated_at = now.to_owned();
    profile.remote_url = Some(result.normalized_url.clone());
    profile.allow_insecure_http = result.insecure_transport.then_some(true);
    profile.last_health = Some(derive_health(result));
    profile.last_deployment_mode = result.deployment_mode;
    profile.last_session_state = Some(result.session_state);
}

fn derive_health(result: &RemotePreflightResult) -> ConnectionHealth {
    match (result.ok, result.session_state, result.reason) {
        (true, SessionState::SignedIn, _) => ConnectionHealth::Healthy,
        (true, SessionState::SignedOut, _) => ConnectionHealth::AuthRequired,
        (_, _, Some(FailureReason::UnsupportedLocalTrusted | FailureReason::AuthNotReady)) => ConnectionHealth::Unsupported,
        (_, _, Some(FailureReason::TlsError | FailureReason::Unreachable)) => ConnectionHealth::Unreachable,
        _ => ConnectionHealth::Unknown,
    }
}

fn local_profile(state: &ConnectionState) -> ConnectionProfile {
    ConnectionProfile {
        id: LOCAL_PROFILE_ID.into(),
        name: state.local_profile_name.clone(),
        mode: ConnectionMode::LocalEmbedded,
        remote_url: None,
        allow_insecure_http: None,
        created_at: EPOCH.into(),
        updated_at: state.local_last_connected_at.clone().unwrap_or_else(|| EPOCH.into()),
        last_connected_at: state.local_last_connected_at.clone(),
        last_health: Some(state.local_last_health.unwrap_or(ConnectionHealth::Healthy)),
        last_deployment_mode: None,
        last_session_state: None,
    }
}

fn profile_name(name: Option<&str>, origin: &str) -> String {
    match name.map(str::trim) {
        Some(trimmed) if !trimmed.is_empty() => trimmed.to_owned(),
        _ => Url::parse(origin).ok().and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_else(|| origin.to_owned()),
    }
}

/// Reads field by field, so a file edited by hand or written by another version loses only what is unusable.
fn sanitize_file(raw: &Value) -> PersistedConnectionsFile {
    if !raw.is_object() {
        return default_file();
    }
    let remote_profiles = raw["remoteProfiles"].as_array().map(|profiles| profiles.iter().filter_map(sanitize_remote_profile).collect()).unwrap_or_default();
    PersistedConnectionsFile { version: CONNECTIONS_FILE_VERSION, state: sanitize_state(&raw["state"]), remote_profiles }
}

fn sanitize_state(raw: &Value) -> ConnectionState {
    if !raw.is_object() {
        return default_state();
    }
    ConnectionState {
        active_profile_id: raw["activeProfileId"].as_str().map(str::to_owned),
        always_show_chooser: raw["alwaysShowChooser"] != false,
        auto_connect_last_profile: raw["autoConnectLastProfile"] == true,
        local_profile_name: raw["localProfileName"].as_str().map(str::trim).filter(|name| !name.is_empty()).unwrap_or("Local").to_owned(),
        local_last_connected_at: raw["localLastConnectedAt"].as_str().map(str::to_owned),
        local_last_health: Some(health(&raw["localLastHealth"]).unwrap_or(ConnectionHealth::Healthy)),
    }
}

fn sanitize_remote_profile(raw: &Value) -> Option<ConnectionProfile> {
    if raw["mode"] != "remote_existing" {
        return None;
    }
    let id = raw["id"].as_str()?;
    let normalized = normalize_remote_url(raw["remoteUrl"].as_str()?).ok()?;
    let created_at = raw["createdAt"].as_str().map(str::to_owned).unwrap_or_else(now_iso);
    Some(ConnectionProfile {
        id: id.to_owned(),
        name: profile_name(raw["name"].as_str(), &normalized.origin),
        mode: ConnectionMode::RemoteExisting,
        remote_url: Some(normalized.normalized_url),
        allow_insecure_http: (normalized.insecure_transport && raw["allowInsecureHttp"] == true).then_some(true),
        updated_at: raw["updatedAt"].as_str().unwrap_or(&created_at).to_owned(),
        created_at,
        last_connected_at: raw["lastConnectedAt"].as_str().map(str::to_owned),
        last_health: Some(health(&raw["lastHealth"]).unwrap_or(ConnectionHealth::Unknown)),
        last_deployment_mode: serde_json::from_value::<DeploymentMode>(raw["lastDeploymentMode"].clone()).ok(),
        last_session_state: Some(serde_json::from_value::<SessionState>(raw["lastSessionState"].clone()).unwrap_or(SessionState::Unknown)),
    })
}

fn health(raw: &Value) -> Option<ConnectionHealth> {
    serde_json::from_value(raw.clone()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-04-06T10:00:00.000Z";

    fn temp_store(name: &str) -> (PathBuf, ConnectionStore) {
        let dir = std::env::temp_dir().join(format!("paperclipdesk-{name}-{}", uuid::Uuid::new_v4()));
        let path = connections_file_path(&dir);
        (path.clone(), ConnectionStore::open(path))
    }

    fn remote(name: &str, url: &str) -> RemoteProfileInput {
        RemoteProfileInput { name: Some(name.into()), remote_url: url.into(), ..Default::default() }
    }

    fn signed_out_result() -> RemotePreflightResult {
        RemotePreflightResult {
            ok: true,
            normalized_url: "https://paperclip-host.tailnet.ts.net/".into(),
            origin: "https://paperclip-host.tailnet.ts.net".into(),
            insecure_transport: false,
            paperclip_detected: true,
            deployment_mode: Some(DeploymentMode::Authenticated),
            deployment_exposure: None,
            auth_ready: Some(true),
            bootstrap_status: None,
            bootstrap_invite_active: None,
            session_state: SessionState::SignedOut,
            version: Some("2026.403.0".into()),
            reason: None,
            warning: None,
            detail: None,
        }
    }

    #[test]
    fn persists_remote_profiles_and_the_startup_preference() {
        let (path, mut store) = temp_store("connections");
        let profile = store.save_remote_profile(remote("Home Server", "https://paperclip-host.tailnet.ts.net/dashboard"), NOW).unwrap();
        store.set_remembered_profile(Some(&profile.id), true);
        store.record_remote_connection(&profile.id, &signed_out_result(), NOW).unwrap();

        let reloaded = ConnectionStore::open(path);
        let remotes = &reloaded.cache.remote_profiles;
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].remote_url.as_deref(), Some("https://paperclip-host.tailnet.ts.net/"));
        assert_eq!(remotes[0].last_health, Some(ConnectionHealth::AuthRequired));
        assert_eq!(reloaded.startup_profile_id(), Some(profile.id));
    }

    #[test]
    fn keeps_a_synthetic_local_profile() {
        let (_, mut store) = temp_store("local");
        assert_eq!(store.startup_profile_id(), None);
        store.record_local_connection(NOW);
        let local = store.profile(LOCAL_PROFILE_ID).unwrap();
        assert_eq!(local.mode, ConnectionMode::LocalEmbedded);
        assert_eq!(local.last_connected_at.as_deref(), Some(NOW));
        store.set_remembered_profile(Some(LOCAL_PROFILE_ID), true);
        assert_eq!(store.startup_profile_id().as_deref(), Some(LOCAL_PROFILE_ID));
        store.set_always_show_chooser(true);
        assert_eq!(store.startup_profile_id(), None);
    }

    #[test]
    fn duplicates_and_deletes_remote_profiles() {
        let (_, mut store) = temp_store("dup");
        let profile = store.save_remote_profile(remote("Dev VM", "https://dev.paperclip.internal"), NOW).unwrap();
        let duplicate = store.duplicate_remote_profile(&profile.id, NOW).unwrap();
        store.delete_remote_profile(&profile.id);

        let remotes: Vec<_> = store.list_profiles().into_iter().filter(|candidate| candidate.mode == ConnectionMode::RemoteExisting).collect();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].id, duplicate.id);
        assert!(remotes[0].name.ends_with("(Kopie)"));
    }

    #[test]
    fn requires_explicit_acknowledgement_before_saving_an_http_profile() {
        let (path, mut store) = temp_store("http");
        assert_eq!(store.save_remote_profile(remote("Insecure", "http://paperclip.example.com"), NOW).unwrap_err(), INSECURE_HTTP_NOT_CONFIRMED);

        let profile = store.save_remote_profile(RemoteProfileInput { allow_insecure_http: true, ..remote("Insecure", "http://paperclip.example.com") }, NOW).unwrap();
        assert_eq!(profile.allow_insecure_http, Some(true));
        assert_eq!(ConnectionStore::open(path).profile(&profile.id).unwrap().allow_insecure_http, Some(true));
    }

    #[test]
    fn editing_keeps_the_id_and_an_unnamed_profile_takes_the_host_name() {
        let (_, mut store) = temp_store("edit");
        let profile = store.save_remote_profile(RemoteProfileInput { remote_url: "https://a.example.com/x".into(), ..Default::default() }, NOW).unwrap();
        assert_eq!(profile.name, "a.example.com");
        let edited = store.save_remote_profile(RemoteProfileInput { profile_id: Some(profile.id.clone()), ..remote("Renamed", "https://b.example.com") }, NOW).unwrap();
        assert_eq!(edited.id, profile.id);
        assert_eq!(store.cache.remote_profiles.len(), 1);
        assert_eq!(store.cache.remote_profiles[0].remote_url.as_deref(), Some("https://b.example.com/"));
    }

    #[test]
    fn reads_a_damaged_file_field_by_field() {
        let raw = serde_json::json!({
            "version": 1,
            "state": { "activeProfileId": 7, "alwaysShowChooser": "yes", "localProfileName": "  " },
            "remoteProfiles": [
                { "id": "ok", "mode": "remote_existing", "remoteUrl": "https://ok.example.com/path", "lastHealth": "bogus" },
                { "id": "no-url", "mode": "remote_existing" },
                { "id": "local", "mode": "local_embedded", "remoteUrl": "https://x.example.com" },
                "garbage",
            ],
        });
        let file = sanitize_file(&raw);
        assert_eq!(file.state.active_profile_id, None);
        assert!(file.state.always_show_chooser);
        assert_eq!(file.state.local_profile_name, "Local");
        assert_eq!(file.remote_profiles.len(), 1);
        assert_eq!(file.remote_profiles[0].name, "ok.example.com");
        assert_eq!(file.remote_profiles[0].last_health, Some(ConnectionHealth::Unknown));
        assert_eq!(sanitize_file(&serde_json::json!([])), default_file());
    }
}
