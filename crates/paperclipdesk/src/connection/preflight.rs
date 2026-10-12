use crate::i18n;
use std::time::Duration;

use serde_json::Value;

use super::http::Fetch;
use super::types::{BootstrapStatus, DeploymentExposure, DeploymentMode, FailureReason, RemotePreflightResult, SessionState};
use super::validate::{NormalizedRemoteUrl, normalize_remote_url};

const TIMEOUT: Duration = Duration::from_secs(8);

struct Health {
    status: String,
    version: Option<String>,
    deployment_mode: DeploymentMode,
    deployment_exposure: Option<DeploymentExposure>,
    auth_ready: Option<bool>,
    bootstrap_status: Option<BootstrapStatus>,
    bootstrap_invite_active: Option<bool>,
}

/// Checks that the URL is an authenticated Paperclip deployment before a window ever loads it.
pub fn preflight_remote_connection(remote_url: &str, local_server_version: Option<&str>, fetch: &dyn Fetch) -> RemotePreflightResult {
    let normalized = match normalize_remote_url(remote_url) {
        Ok(normalized) => normalized,
        Err(detail) => return failure(remote_url.trim(), "", false, FailureReason::InvalidUrl, detail, None),
    };
    match probe(&normalized, local_server_version, fetch) {
        Ok(result) => result,
        Err(error) => failure(&normalized.normalized_url, &normalized.origin, normalized.insecure_transport, classify_fetch_error(&error), error, normalized.warning.clone()),
    }
}

fn probe(normalized: &NormalizedRemoteUrl, local_server_version: Option<&str>, fetch: &dyn Fetch) -> Result<RemotePreflightResult, String> {
    let response = fetch.get(&format!("{}/api/health", normalized.origin), TIMEOUT)?;
    let body = if response.is_json() { response.json()? } else { Value::Null };
    let Some(health) = (response.status == 200).then(|| parse_health(&body)).flatten() else {
        return Ok(failure(
            &normalized.normalized_url,
            &normalized.origin,
            normalized.insecure_transport,
            FailureReason::NotPaperclip,
            i18n::t("Dieser Host stellt offenbar keinen Paperclip-Health-Endpunkt bereit.").into(),
            normalized.warning.clone(),
        ));
    };

    let detected = |session_state: SessionState, rejected: Option<(FailureReason, &str)>| RemotePreflightResult {
        ok: rejected.is_none(),
        normalized_url: normalized.normalized_url.clone(),
        origin: normalized.origin.clone(),
        insecure_transport: normalized.insecure_transport,
        paperclip_detected: true,
        deployment_mode: Some(health.deployment_mode),
        deployment_exposure: health.deployment_exposure,
        auth_ready: health.auth_ready,
        bootstrap_status: health.bootstrap_status,
        bootstrap_invite_active: health.bootstrap_invite_active,
        session_state,
        version: health.version.clone(),
        reason: rejected.map(|(reason, _)| reason),
        warning: version_warning(health.version.as_deref(), local_server_version, normalized.warning.as_deref()),
        detail: rejected.map(|(_, detail)| detail.to_owned()),
    };

    if health.status != "ok" {
        return Ok(detected(SessionState::Unknown, Some((FailureReason::Unreachable, i18n::t("Paperclip hat geantwortet, aber die Instanz ist noch nicht bereit.")))));
    }
    if health.deployment_mode == DeploymentMode::LocalTrusted {
        return Ok(detected(
            SessionState::Unknown,
            Some((
                FailureReason::UnsupportedLocalTrusted,
                i18n::t("Dieser Paperclip-Server ist nur für lokale Loopback-Nutzung eingerichtet. Stelle ihn auf den authentifizierten Modus um, bevor du ihn als Remote verwendest."),
            )),
        ));
    }
    if health.auth_ready == Some(false) {
        return Ok(detected(SessionState::Unknown, Some((FailureReason::AuthNotReady, i18n::t("Der Remote meldet den authentifizierten Modus, aber seine Anmeldung ist noch nicht bereit.")))));
    }

    let session_state = probe_session(&normalized.origin, fetch)?;
    if session_state == SessionState::Unknown {
        return Ok(detected(SessionState::Unknown, Some((FailureReason::NotPaperclip, i18n::t("Die Sitzungsabfrage des Remotes hat unerwartet geantwortet.")))));
    }
    Ok(detected(session_state, None))
}

/// Whether the caller, as `fetch` identifies it, is signed in at `origin`.
pub fn probe_session(origin: &str, fetch: &dyn Fetch) -> Result<SessionState, String> {
    let response = fetch.get(&format!("{origin}/api/auth/get-session"), TIMEOUT)?;
    if !response.is_json() {
        return Ok(SessionState::Unknown);
    }
    let body = response.json()?;
    Ok(match response.status {
        401 if body["error"] == "Board authentication required" => SessionState::SignedOut,
        200 if is_paperclip_session(&body["session"]) => SessionState::SignedIn,
        _ => SessionState::Unknown,
    })
}

fn is_paperclip_session(session: &Value) -> bool {
    session["id"].as_str().is_some_and(|id| id.starts_with("paperclip:")) && session["userId"].as_str().is_some_and(|user| !user.is_empty())
}

fn parse_health(body: &Value) -> Option<Health> {
    if !body.is_object() {
        return None;
    }
    let deployment_mode = match body["deploymentMode"].as_str() {
        Some("authenticated") => DeploymentMode::Authenticated,
        Some("local_trusted") => DeploymentMode::LocalTrusted,
        _ => return None,
    };
    let deployment_exposure = match body["deploymentExposure"].as_str() {
        Some("private") => Some(DeploymentExposure::Private),
        Some("public") => Some(DeploymentExposure::Public),
        _ => None,
    };
    let bootstrap_status = match body["bootstrapStatus"].as_str() {
        Some("ready") => Some(BootstrapStatus::Ready),
        Some("bootstrap_pending") => Some(BootstrapStatus::BootstrapPending),
        _ => None,
    };
    let auth_ready = body["authReady"].as_bool();
    let bootstrap_invite_active = body["bootstrapInviteActive"].as_bool();
    let status = body["status"].as_str()?.to_owned();
    if status.is_empty() {
        return None;
    }

    let full_shape = deployment_exposure.is_some() && auth_ready.is_some();
    // A public deployment hides its details from signed-out callers.
    let redacted_authenticated_shape =
        status == "ok" && deployment_mode == DeploymentMode::Authenticated && bootstrap_status.is_some() && bootstrap_invite_active.is_some() && auth_ready.is_none();
    if !full_shape && !redacted_authenticated_shape {
        return None;
    }

    Some(Health { status, version: body["version"].as_str().map(str::to_owned), deployment_mode, deployment_exposure, auth_ready, bootstrap_status, bootstrap_invite_active })
}

fn failure(normalized_url: &str, origin: &str, insecure_transport: bool, reason: FailureReason, detail: String, warning: Option<String>) -> RemotePreflightResult {
    RemotePreflightResult {
        ok: false,
        normalized_url: normalized_url.to_owned(),
        origin: origin.to_owned(),
        insecure_transport,
        paperclip_detected: false,
        deployment_mode: None,
        deployment_exposure: None,
        auth_ready: None,
        bootstrap_status: None,
        bootstrap_invite_active: None,
        session_state: SessionState::Unknown,
        version: None,
        reason: Some(reason),
        warning,
        detail: Some(detail),
    }
}

fn classify_fetch_error(message: &str) -> FailureReason {
    let message = message.to_lowercase();
    if ["self-signed", "certificate", "unable to verify", "tls"].iter().any(|hint| message.contains(hint)) {
        FailureReason::TlsError
    } else {
        FailureReason::Unreachable
    }
}

fn version_warning(remote_version: Option<&str>, local_server_version: Option<&str>, existing: Option<&str>) -> Option<String> {
    let mut warnings: Vec<String> = existing.map(str::to_owned).into_iter().collect();
    if let (Some(remote), Some(local)) = (remote_version, local_server_version)
        && remote != local
    {
        warnings.push(i18n::f("Die Paperclip-Version {} des Remotes weicht von der Server-Version {} dieser App ab.", &[&remote, &local]));
    }
    (!warnings.is_empty()).then(|| warnings.join(" "))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::http::testing::{FakeFetch, json_response};
    use super::*;

    fn full_health(deployment_mode: &str, auth_ready: bool, bootstrap_status: &str) -> Value {
        json!({
            "status": "ok",
            "version": "2026.403.0",
            "deploymentMode": deployment_mode,
            "deploymentExposure": "private",
            "authReady": auth_ready,
            "bootstrapStatus": bootstrap_status,
            "bootstrapInviteActive": false,
        })
    }

    fn redacted_health() -> Value {
        json!({ "status": "ok", "deploymentMode": "authenticated", "bootstrapStatus": "ready", "bootstrapInviteActive": false })
    }

    fn signed_in() -> Result<super::super::http::HttpResponse, String> {
        json_response(json!({ "session": { "id": "paperclip:session:1", "userId": "user-1" }, "user": { "id": "user-1" } }), 200)
    }

    fn auth_required() -> Result<super::super::http::HttpResponse, String> {
        json_response(json!({ "error": "Board authentication required" }), 401)
    }

    #[test]
    fn accepts_authenticated_paperclip_with_an_active_session() {
        let fetch = FakeFetch::new(vec![json_response(full_health("authenticated", true, "ready"), 200), signed_in()]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", Some("2026.403.0"), &fetch);
        assert!(result.ok);
        assert!(!result.insecure_transport);
        assert_eq!(result.session_state, SessionState::SignedIn);
        assert_eq!(result.deployment_mode, Some(DeploymentMode::Authenticated));
        assert_eq!(result.bootstrap_status, Some(BootstrapStatus::Ready));
        assert_eq!(result.warning, None);
    }

    #[test]
    fn treats_a_401_session_probe_as_sign_in_required() {
        let fetch = FakeFetch::new(vec![json_response(full_health("authenticated", true, "bootstrap_pending"), 200), auth_required()]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch);
        assert!(result.ok);
        assert_eq!(result.session_state, SessionState::SignedOut);
        assert_eq!(result.bootstrap_status, Some(BootstrapStatus::BootstrapPending));
    }

    #[test]
    fn accepts_redacted_authenticated_health() {
        let fetch = FakeFetch::new(vec![json_response(redacted_health(), 200), auth_required()]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch);
        assert!(result.ok);
        assert_eq!(result.session_state, SessionState::SignedOut);
        assert_eq!(result.deployment_mode, Some(DeploymentMode::Authenticated));
        assert_eq!(result.deployment_exposure, None);
        assert_eq!(result.auth_ready, None);
        assert_eq!(result.bootstrap_status, Some(BootstrapStatus::Ready));
        assert_eq!(result.bootstrap_invite_active, Some(false));

        let with_session = json!({ "status": "ok", "deploymentMode": "authenticated", "bootstrapStatus": "bootstrap_pending", "bootstrapInviteActive": true });
        let fetch = FakeFetch::new(vec![json_response(with_session, 200), signed_in()]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net/some/path?ignored=true#hash", None, &fetch);
        assert!(result.ok);
        assert_eq!(result.normalized_url, "https://paperclip-host.tailnet.ts.net/");
        assert_eq!(result.session_state, SessionState::SignedIn);
        assert_eq!(result.bootstrap_invite_active, Some(true));

        let with_exposure = json!({ "status": "ok", "deploymentMode": "authenticated", "deploymentExposure": "public", "bootstrapStatus": "ready", "bootstrapInviteActive": false });
        let fetch = FakeFetch::new(vec![json_response(with_exposure, 200), auth_required()]);
        let result = preflight_remote_connection("https://paperclip-host.example.com", None, &fetch);
        assert!(result.ok);
        assert_eq!(result.deployment_exposure, Some(DeploymentExposure::Public));
    }

    #[test]
    fn rejects_redacted_health_that_is_not_backed_by_paperclip_auth() {
        let fetch = FakeFetch::new(vec![json_response(redacted_health(), 200), json_response(json!({ "error": "Unauthorized" }), 401)]);
        let result = preflight_remote_connection("https://example.com", None, &fetch);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(FailureReason::NotPaperclip));
        assert!(result.paperclip_detected);
        assert_eq!(result.session_state, SessionState::Unknown);

        let without_invite_state = json!({ "status": "ok", "deploymentMode": "authenticated", "bootstrapStatus": "ready" });
        let fetch = FakeFetch::new(vec![json_response(without_invite_state, 200)]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(FailureReason::NotPaperclip));
        assert!(!result.paperclip_detected);
    }

    #[test]
    fn rejects_deployments_that_cannot_serve_a_remote() {
        let fetch = FakeFetch::new(vec![json_response(full_health("authenticated", false, "ready"), 200)]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch);
        assert_eq!(result.reason, Some(FailureReason::AuthNotReady));
        assert!(result.paperclip_detected);

        let fetch = FakeFetch::new(vec![json_response(full_health("local_trusted", true, "ready"), 200)]);
        let result = preflight_remote_connection("https://192.168.1.50:3100", None, &fetch);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(FailureReason::UnsupportedLocalTrusted));

        let mut starting = full_health("authenticated", true, "ready");
        starting["status"] = json!("starting");
        let fetch = FakeFetch::new(vec![json_response(starting, 200)]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch);
        assert_eq!(result.reason, Some(FailureReason::Unreachable));
        assert!(result.paperclip_detected);
    }

    #[test]
    fn rejects_other_schemes_before_any_network_call() {
        let fetch = FakeFetch::new(vec![]);
        let result = preflight_remote_connection("ftp://paperclip.example.com", None, &fetch);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(FailureReason::InvalidUrl));
        assert!(result.detail.unwrap().contains("HTTP oder HTTPS"));
        assert!(fetch.calls.borrow().is_empty());
    }

    #[test]
    fn allows_http_remotes_and_carries_the_warnings() {
        let fetch = FakeFetch::new(vec![json_response(full_health("authenticated", true, "ready"), 200), auth_required()]);
        let result = preflight_remote_connection("http://paperclip.example.com:3200", Some("2026.1001.0"), &fetch);
        assert!(result.ok);
        assert!(result.insecure_transport);
        assert_eq!(result.origin, "http://paperclip.example.com:3200");
        let warning = result.warning.unwrap();
        assert!(warning.contains("ohne TLS"));
        assert!(warning.contains("2026.403.0") && warning.contains("2026.1001.0"));
    }

    #[test]
    fn rejects_endpoints_that_are_not_paperclip() {
        let fetch = FakeFetch::new(vec![json_response(json!({ "hello": "world" }), 200)]);
        assert_eq!(preflight_remote_connection("https://example.com", None, &fetch).reason, Some(FailureReason::NotPaperclip));

        let fetch = FakeFetch::new(vec![json_response(redacted_health(), 503)]);
        assert_eq!(preflight_remote_connection("https://paperclip-host.tailnet.ts.net", None, &fetch).reason, Some(FailureReason::NotPaperclip));

        let fetch = FakeFetch::new(vec![Ok(super::super::http::HttpResponse { status: 200, content_type: "text/html".into(), body: String::new() })]);
        assert_eq!(preflight_remote_connection("https://example.com", None, &fetch).reason, Some(FailureReason::NotPaperclip));
    }

    #[test]
    fn probes_only_fixed_paths_on_the_normalized_origin() {
        let fetch = FakeFetch::new(vec![json_response(redacted_health(), 200), auth_required()]);
        let result = preflight_remote_connection("https://paperclip-host.tailnet.ts.net/user/input?next=https://evil.test#fragment", None, &fetch);
        assert!(result.ok);
        assert_eq!(*fetch.calls.borrow(), ["https://paperclip-host.tailnet.ts.net/api/health", "https://paperclip-host.tailnet.ts.net/api/auth/get-session"]);
    }

    #[test]
    fn classifies_transport_failures() {
        let fetch = FakeFetch::new(vec![Err("invalid peer certificate: UnknownIssuer".into())]);
        let result = preflight_remote_connection("https://badcert.example.com", None, &fetch);
        assert!(!result.ok);
        assert_eq!(result.reason, Some(FailureReason::TlsError));

        let fetch = FakeFetch::new(vec![Err("timeout: global".into())]);
        assert_eq!(preflight_remote_connection("https://slow.example.com", None, &fetch).reason, Some(FailureReason::Unreachable));
    }
}
