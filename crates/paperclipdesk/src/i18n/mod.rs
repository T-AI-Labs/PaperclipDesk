mod ar;
mod de;
mod en;
mod es;
mod fr;
mod hi;
mod it;
mod ja;
mod pt;
mod ru;
mod zh;

use std::fmt::Display;
use std::sync::atomic::{AtomicUsize, Ordering};

/// The languages of the app, by their code in the settings. German is what the code itself is written in.
const LANGUAGES: [(&str, Option<&[&str; de::MESSAGES.len()]>); 11] = [
    ("en", Some(&en::CATALOG)),
    ("de", None),
    ("ar", Some(&ar::CATALOG)),
    ("es", Some(&es::CATALOG)),
    ("fr", Some(&fr::CATALOG)),
    ("hi", Some(&hi::CATALOG)),
    ("it", Some(&it::CATALOG)),
    ("ja", Some(&ja::CATALOG)),
    ("pt", Some(&pt::CATALOG)),
    ("ru", Some(&ru::CATALOG)),
    ("zh", Some(&zh::CATALOG)),
];

/// Tests read the texts as the code has them.
static CURRENT: AtomicUsize = AtomicUsize::new(if cfg!(test) { 1 } else { 0 });

/// `setting` is a language code or "System", which follows the language Windows runs in; unknown languages fall back to English.
pub fn set(setting: &str) {
    let wanted = if setting.eq_ignore_ascii_case("system") { sys_locale::get_locale().unwrap_or_default() } else { setting.to_owned() };
    let code = wanted.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
    CURRENT.store(LANGUAGES.iter().position(|(language, _)| *language == code).unwrap_or(0), Ordering::Relaxed);
}

/// The language in use, for the window to follow.
pub fn current() -> &'static str {
    LANGUAGES[CURRENT.load(Ordering::Relaxed)].0
}

/// `message` in the current language.
pub fn t(message: &'static str) -> &'static str {
    let Some(catalog) = LANGUAGES[CURRENT.load(Ordering::Relaxed)].1 else { return message };
    de::MESSAGES.iter().position(|known| *known == message).map_or(message, |index| catalog[index])
}

/// `message` in the current language, each `{}` filled with the next argument.
pub fn f(message: &'static str, arguments: &[&dyn Display]) -> String {
    let mut parts = t(message).split("{}");
    let mut text = parts.next().unwrap_or_default().to_owned();
    for (part, argument) in parts.zip(arguments) {
        text.push_str(&argument.to_string());
        text.push_str(part);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCES: [&str; 11] = [
        include_str!("../instance.rs"),
        include_str!("../client.rs"),
        include_str!("../menu.rs"),
        include_str!("../server.rs"),
        include_str!("../server_package.rs"),
        include_str!("../updater.rs"),
        include_str!("../main.rs"),
        include_str!("../logs.rs"),
        include_str!("../connection/validate.rs"),
        include_str!("../connection/preflight.rs"),
        include_str!("../connection/profiles.rs"),
    ];

    /// The string literals handed to `i18n::t` and `i18n::f` anywhere in the code.
    fn used_messages() -> Vec<String> {
        let mut used = Vec::new();
        for source in SOURCES {
            for call in ["i18n::t(\"", "i18n::f(\""] {
                for (start, _) in source.match_indices(call) {
                    let literal = &source[start + call.len()..];
                    let mut end = 0;
                    let bytes = literal.as_bytes();
                    while bytes[end] != b'"' {
                        end += if bytes[end] == b'\\' { 2 } else { 1 };
                    }
                    used.push(literal[..end].replace("\\n", "\n"));
                }
            }
        }
        used
    }

    #[test]
    fn every_text_in_the_code_is_in_the_catalogue() {
        let used = used_messages();
        assert!(used.len() > 80, "the scan found only {} texts", used.len());
        for message in used {
            assert!(de::MESSAGES.contains(&message.as_str()), "not in i18n/de.rs: {message}");
        }
    }

    #[test]
    fn every_translation_fills_the_same_placeholders() {
        for (language, catalog) in LANGUAGES {
            let Some(catalog) = catalog else { continue };
            for (message, translation) in de::MESSAGES.iter().zip(catalog) {
                assert!(!translation.trim().is_empty(), "{language}: no translation for {message}");
                assert_eq!(translation.matches("{}").count(), message.matches("{}").count(), "{language}: {message} -> {translation}");
                assert_eq!(translation.matches('\n').count(), message.matches('\n').count(), "{language}: {message} -> {translation}");
            }
        }
    }

    #[test]
    fn placeholders_are_filled_in_order() {
        assert_eq!(f("Kein freier Port im Bereich {}–{} gefunden.", &[&3100, &3199]), "Kein freier Port im Bereich 3100–3199 gefunden.");
        assert_eq!(f("{} (Kopie)", &[&"Dev"]), "Dev (Kopie)");
        assert_eq!(t("not a known text"), "not a known text");
    }
}
