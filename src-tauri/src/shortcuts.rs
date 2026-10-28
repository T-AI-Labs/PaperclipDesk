use std::collections::BTreeMap;
use std::sync::Arc;

use tauri::webview::Webview;
use tauri::{AppHandle, Manager};
use webview2_com::AcceleratorKeyPressedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS};

use crate::client::Client;

/// The action that shows the menu bar again, so it needs a key from the start.
pub const TOGGLE_MENU_BAR: &str = "view.menu_bar";

/// The keys a new installation starts with; every other action waits for the user to give it one.
pub fn defaults() -> BTreeMap<String, String> {
    [(TOGGLE_MENU_BAR, "F10"), ("view.fullscreen", "F11")].into_iter().map(|(action, keys)| (action.to_owned(), keys.to_owned())).collect()
}

/// The name of a key as shortcuts spell it, e.g. "F10", "K" or "7"; `None` for a modifier or a key that cannot be bound.
fn key_name(vk: u32) -> Option<String> {
    let name = match vk {
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk)?.to_string(),
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x60..=0x69 => format!("Num{}", vk - 0x60),
        0x20 => "Space".into(),
        0x1B => "Escape".into(),
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x21 => "PageUp".into(),
        0x22 => "PageDown".into(),
        0x23 => "End".into(),
        0x24 => "Home".into(),
        0x25 => "Left".into(),
        0x26 => "Up".into(),
        0x27 => "Right".into(),
        0x28 => "Down".into(),
        0x2D => "Insert".into(),
        0x2E => "Delete".into(),
        0xBB | 0x6B => "Plus".into(),
        0xBD | 0x6D => "Minus".into(),
        0xBC => "Comma".into(),
        0xBE => "Period".into(),
        _ => return None,
    };
    Some(name)
}

/// The shortcut for a key and the modifiers held with it, e.g. "Ctrl+Shift+K".
fn accelerator(vk: u32, ctrl: bool, alt: bool, shift: bool) -> Option<String> {
    let key = key_name(vk)?;
    let modifiers = [(ctrl, "Ctrl"), (alt, "Alt"), (shift, "Shift")].into_iter().filter(|(held, _)| *held).map(|(_, name)| name);
    Some(modifiers.chain([key.as_str()]).collect::<Vec<_>>().join("+"))
}

fn held(vk: i32) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    // The key went to a window of WebView2's own process, so this thread's key state knows nothing of it.
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

/// Catches the keys pressed in the webview before its page sees them: while the user assigns a shortcut, and for every key that has an action.
pub fn watch(webview: &Webview, handle: AppHandle) {
    let _ = webview.with_webview(move |platform| {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            let (mut vk, mut status) = (0u32, COREWEBVIEW2_PHYSICAL_KEY_STATUS::default());
            unsafe {
                args.KeyEventKind(&mut kind)?;
                args.VirtualKey(&mut vk)?;
                args.PhysicalKeyStatus(&mut status)?;
            }
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                return Ok(());
            }
            let Some(keys) = accelerator(vk, held(0x11), held(0x12), held(0x10)) else { return Ok(()) };
            let client = Arc::clone(&handle.state::<Arc<Client>>());
            let repeated = status.WasKeyDown.as_bool();
            if client.pressed(&keys, repeated) {
                unsafe { args.SetHandled(true)? };
            }
            Ok(())
        }));
        let mut token = 0;
        if let Err(e) = unsafe { platform.controller().add_AcceleratorKeyPressed(&handler, &mut token) } {
            tracing::warn!("watching the keyboard: {e}");
        }
    });
}

/// The action a key starts, if the user gave it one.
pub fn action_for<'a>(shortcuts: &'a BTreeMap<String, String>, keys: &str) -> Option<&'a str> {
    shortcuts.iter().find(|(_, bound)| bound.eq_ignore_ascii_case(keys)).map(|(action, _)| action.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_spelled_with_their_modifiers_in_a_fixed_order() {
        assert_eq!(accelerator(0x79, false, false, false).as_deref(), Some("F10"));
        assert_eq!(accelerator(0x4B, true, false, true).as_deref(), Some("Ctrl+Shift+K"));
        assert_eq!(accelerator(0xBB, true, true, false).as_deref(), Some("Ctrl+Alt+Plus"));
    }

    #[test]
    fn a_modifier_alone_is_no_shortcut() {
        assert_eq!(accelerator(0x11, true, false, false), None);
        assert_eq!(accelerator(0x12, false, true, false), None);
    }

    #[test]
    fn a_key_finds_the_action_bound_to_it() {
        assert_eq!(action_for(&defaults(), "F10"), Some(TOGGLE_MENU_BAR));
        assert_eq!(action_for(&defaults(), "F9"), None);
    }
}
