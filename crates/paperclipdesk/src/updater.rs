use crate::i18n;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::client::{Client, LAUNCHER_LABEL};

pub const PROGRESS_EVENT: &str = "updater:progress";

/// The update the last check found, kept until the user agrees to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOffer {
    update_available: bool,
    version: Option<String>,
    /// Markdown, straight out of `latest.json`.
    notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: u64,
    content_length: Option<u64>,
}

/// Only reports what is on offer. Nothing is downloaded until the user has seen the version and
/// agreed to it, because installing ends with the app restarting.
pub async fn check(app: &AppHandle) -> Result<UpdateOffer, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let offer = UpdateOffer { update_available: update.is_some(), version: update.as_ref().map(|u| u.version.clone()), notes: update.as_ref().and_then(|u| u.body.clone()) };
    *app.state::<PendingUpdate>().0.lock().unwrap() = update;
    Ok(offer)
}

/// Never returns on success: the installer ends this process and starts the new version.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = app.state::<PendingUpdate>().0.lock().unwrap().take().ok_or(i18n::t("Es wartet kein Update auf die Installation."))?;
    tracing::info!(version = %update.version, "installing update");

    let handle = app.clone();
    let mut downloaded = 0u64;
    let mut last_step = u64::MAX;
    let installer = update
        .download(
            move |chunk, content_length| {
                downloaded += chunk as u64;
                // The bar has a hundred steps, and an unmeasured download only counts megabytes.
                let step = match content_length {
                    Some(total) if total > 0 => downloaded * 100 / total,
                    _ => downloaded / 1_048_576,
                };
                if step != last_step {
                    last_step = step;
                    let _ = handle.emit_to(LAUNCHER_LABEL, PROGRESS_EVENT, Progress { downloaded, content_length });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // The installer replaces the exe and ends this process without the usual exit, so the local server stops here.
    app.state::<Arc<Client>>().shutdown();
    update.install(installer).map_err(|e| e.to_string())?;
    app.restart();
}
