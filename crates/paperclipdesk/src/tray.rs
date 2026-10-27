use std::sync::{Arc, Mutex};

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::client::Client;
use crate::i18n;
use crate::menu::Entry;

const ID: &str = "tray";
const SHOW: &str = "tray.show";
/// The menus of the menu bar the tray offers too: company, new and go to; help stays in the window.
const MENUS: usize = 3;

/// The menus the tray's menu was last built from; it is built again only when they change.
static BUILT_FROM: Mutex<String> = Mutex::new(String::new());

/// Shows or hides the tray icon, as `show` says.
pub fn sync(handle: &AppHandle, show: bool) {
    // Tauri keeps a removed icon alive and on screen, so the icon is made once and then only hidden.
    let synced = match handle.tray_by_id(ID) {
        Some(tray) => tray.set_visible(show),
        None if show => build(handle),
        None => Ok(()),
    };
    if let Err(e) = synced {
        tracing::warn!("updating the tray icon: {e}");
    }
}

/// Gives the tray the menus of the menu bar as they are now, with the companies and in the app's language.
pub fn follow(handle: &AppHandle, menus: &[crate::menu::Menu]) {
    let Some(tray) = handle.tray_by_id(ID) else { return };
    let wanted = serde_json::to_string(&menus[..menus.len().min(MENUS)]).unwrap_or_default();
    let mut built = BUILT_FROM.lock().unwrap();
    if *built == wanted {
        return;
    }
    match menu(handle, menus).and_then(|menu| tray.set_menu(Some(menu))) {
        Ok(()) => *built = wanted,
        Err(e) => tracing::warn!("updating the tray menu: {e}"),
    }
}

fn menu(handle: &AppHandle, menus: &[crate::menu::Menu]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(handle)?;
    menu.append(&MenuItem::with_id(handle, SHOW, i18n::t("Paperclip anzeigen"), true, None::<&str>)?)?;
    for bar in menus.iter().take(MENUS) {
        let submenu = Submenu::new(handle, &bar.label, true)?;
        for entry in &bar.entries {
            let item: Box<dyn IsMenuItem<Wry>> = match entry {
                Entry::Item { id, label, enabled, checked: Some(checked) } => Box::new(CheckMenuItem::with_id(handle, id, label, *enabled, *checked, None::<&str>)?),
                Entry::Item { id, label, enabled, checked: None } => Box::new(MenuItem::with_id(handle, id, label, *enabled, None::<&str>)?),
                Entry::Separator => Box::new(PredefinedMenuItem::separator(handle)?),
                // A native menu has no headings; a greyed entry stands in for one.
                Entry::Label { label } => Box::new(MenuItem::new(handle, label, false, None::<&str>)?),
            };
            submenu.append(item.as_ref())?;
        }
        menu.append(&submenu)?;
    }
    menu.append(&PredefinedMenuItem::separator(handle)?)?;
    menu.append(&MenuItem::with_id(handle, "shell.settings", i18n::t("Einstellungen …"), true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(handle, "app.quit", i18n::t("Beenden"), true, None::<&str>)?)?;
    Ok(menu)
}

fn build(handle: &AppHandle) -> tauri::Result<()> {
    let menus = crate::menu::build(&handle.state::<Arc<Client>>());
    let mut tray = TrayIconBuilder::with_id(ID).tooltip("PaperclipDesk").menu(&menu(handle, &menus)?).show_menu_on_left_click(false);
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
    *BUILT_FROM.lock().unwrap() = serde_json::to_string(&menus[..menus.len().min(MENUS)]).unwrap_or_default();
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
        if id.starts_with("shell.") {
            client.shell_action(&id);
        } else if id != SHOW {
            crate::menu::handle(&client, &id);
        }
    });
}
