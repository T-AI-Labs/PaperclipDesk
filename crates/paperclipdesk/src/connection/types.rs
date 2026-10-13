use serde::{Deserialize, Serialize};

pub const LOCAL_PROFILE_ID: &str = "local_embedded";
pub const CONNECTIONS_FILE_NAME: &str = "connections.json";
pub const CONNECTIONS_FILE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionMode {
    LocalEmbedded,
    RemoteExisting,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionHealth {
    Healthy,
    AuthRequired,
    Unsupported,
    Unreachable,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentMode {
    LocalTrusted,
    Authenticated,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentExposure {
    Private,
    Public,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    SignedIn,
    SignedOut,
    Unknown,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapStatus {
    Ready,
    BootstrapPending,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FailureReason {
    InvalidUrl,
    Unreachable,
    TlsError,
    NotPaperclip,
    UnsupportedLocalTrusted,
    AuthNotReady,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub mode: ConnectionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_insecure_http: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_health: Option<ConnectionHealth>,
    pub last_deployment_mode: Option<DeploymentMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_session_state: Option<SessionState>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub active_profile_id: Option<String>,
    pub always_show_chooser: bool,
    pub auto_connect_last_profile: bool,
    pub local_profile_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_last_connected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_last_health: Option<ConnectionHealth>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PersistedConnectionsFile {
    pub version: u32,
    pub state: ConnectionState,
    pub remote_profiles: Vec<ConnectionProfile>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemotePreflightResult {
    pub ok: bool,
    pub normalized_url: String,
    pub origin: String,
    pub insecure_transport: bool,
    pub paperclip_detected: bool,
    pub deployment_mode: Option<DeploymentMode>,
    pub deployment_exposure: Option<DeploymentExposure>,
    pub auth_ready: Option<bool>,
    pub bootstrap_status: Option<BootstrapStatus>,
    pub bootstrap_invite_active: Option<bool>,
    pub session_state: SessionState,
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<FailureReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
