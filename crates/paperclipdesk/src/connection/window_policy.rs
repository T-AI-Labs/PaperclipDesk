use sha2::{Digest, Sha256};
use url::Url;

pub const LOCAL_PARTITION: &str = "paperclip-local";

pub fn is_navigation_allowed(target_url: &str, allowed_origin: &str) -> bool {
    Url::parse(target_url).is_ok_and(|parsed| parsed.origin().ascii_serialization() == allowed_origin)
}

pub fn should_open_externally(target_url: &str, allowed_origin: &str) -> bool {
    Url::parse(target_url).is_ok_and(|parsed| parsed.origin().ascii_serialization() != allowed_origin && matches!(parsed.scheme(), "http" | "https"))
}

/// The browser profile a remote window keeps its session in: one per saved profile, one per origin otherwise.
pub fn remote_partition(profile_id: Option<&str>, origin: &str) -> String {
    match profile_id {
        Some(id) => format!("paperclip-remote-{id}"),
        None => {
            let digest = Sha256::digest(origin.as_bytes());
            let hash: String = digest.iter().take(6).map(|byte| format!("{byte:02x}")).collect();
            format!("paperclip-remote-{hash}")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_same_origin_navigation_is_allowed() {
        let allowed_origin = "https://paperclip-host.tailnet.ts.net";
        assert!(is_navigation_allowed("https://paperclip-host.tailnet.ts.net/dashboard", allowed_origin));
        assert!(!is_navigation_allowed("https://example.com", allowed_origin));
        assert!(!is_navigation_allowed("not a url", allowed_origin));
    }

    #[test]
    fn http_links_outside_the_allowed_origin_open_externally() {
        let allowed_origin = "http://localhost:3100";
        assert!(should_open_externally("https://docs.paperclip.ing", allowed_origin));
        assert!(!should_open_externally("http://localhost:3100/settings", allowed_origin));
        assert!(!should_open_externally("mailto:test@example.com", allowed_origin));
    }

    #[test]
    fn remote_partitions_are_isolated_per_profile_or_origin() {
        assert_eq!(remote_partition(Some("abc123"), "https://a.example"), "paperclip-remote-abc123");
        let unsaved = remote_partition(None, "https://a.example");
        assert_eq!(unsaved.len(), "paperclip-remote-".len() + 12);
        assert_eq!(unsaved, remote_partition(None, "https://a.example"));
        assert_ne!(unsaved, remote_partition(None, "https://b.example"));
    }
}
