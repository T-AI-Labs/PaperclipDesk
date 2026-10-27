use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::client::Client;
use crate::i18n;

const ID: &str = "tray";
const SHOW: &str = "tray.show";

/// Shows or hides the tray icon, as `show` says; `relabel` gives it the menu in the current language.
pub fn sync(handle: &AppHandle, show: bool, relabel: bool) {
    // Tauri keeps a removed icon alive and on screen, so the icon is made once and then only hidden.
    let synced = match handle.tray_by_id(ID) {
        Some(tray) => (if relabel { menu(handle).and_then(|menu| tray.set_menu(Some(menu))) } else { Ok(()) }).and_then(|()| tray.set_visible(show)),
        None if show => build(handle),
        None => Ok(()),
    };
    if let Err(e) = synced {
        tracing::warn!("updating the tray icon: {e}");
    }
}

fn menu(handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str| MenuItem::with_id(handle, id, label, true, None::<&str>);
    Menu::with_items(
        handle,
        &[
            &item(SHOW, i18n::t("Paperclip anzeigen"))?,
            &item("shell.templates", i18n::t("Firma aus Vorlage …"))?,
            &item("shell.updates", i18n::t("Nach Updates suchen …"))?,
            &PredefinedMenuItem::separator(handle)?,
            &item("shell.settings", i18n::t("Einstellungen …"))?,
            &item("app.quit", i18n::t("Beenden"))?,
        ],
    )
}

fn build(handle: &AppHandle) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(ID).tooltip("PaperclipDesk").menu(&menu(handle)?).show_menu_on_left_click(false);
    if let Some(icon) = handle.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|handle, event| picked(handle, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                picked(tray.app_handle(), SHOW);
            }
        })
        .build(handle)?;
    Ok(())
}

fn picked(handle: &AppHandle, id: &str) {
    let client = Arc::clone(&handle.state::<Arc<Client>>());
    let id = id.to_owned();
    // Bringing the window forward waits on the main thread, which delivers this event.
    std::thread::spawn(move || {
        if id == "app.quit" {
            return crate::menu::handle(&client, &id);
        }
        client.focus_existing();
        if id != SHOW {
            client.shell_action(&id);
        }
    });
}
