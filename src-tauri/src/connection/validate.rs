use crate::i18n;
use url::{Host, Url};

#[derive(Clone, PartialEq, Debug)]
pub struct NormalizedRemoteUrl {
    pub normalized_url: String,
    pub origin: String,
    pub insecure_transport: bool,
    pub warning: Option<String>,
}

const PRIVATE_HOST_SUFFIXES: [&str; 5] = [".internal", ".local", ".lan", ".home", ".ts.net"];
const INVALID_URL: &str = "Bitte eine gültige Remote-URL eingeben.";

pub fn normalize_remote_url(input: &str) -> Result<NormalizedRemoteUrl, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(i18n::t(INVALID_URL).into());
    }
    let mut parsed = Url::parse(trimmed).map_err(|_| i18n::t(INVALID_URL).to_string())?;

    let is_http = parsed.scheme() == "http";
    if !is_http && parsed.scheme() != "https" {
        return Err(i18n::t("Remote-URLs müssen HTTP oder HTTPS verwenden.").into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(i18n::t("Remote-URLs dürfen weder Benutzername noch Passwort enthalten.").into());
    }

    parsed.set_path("/");
    parsed.set_query(None);
    parsed.set_fragment(None);

    Ok(NormalizedRemoteUrl {
        normalized_url: parsed.to_string(),
        origin: parsed.origin().ascii_serialization(),
        insecure_transport: is_http,
        warning: is_http.then(|| insecure_http_warning(parsed.host_str().unwrap_or_default())),
    })
}

pub fn is_private_hostname(hostname: &str) -> bool {
    let lower = hostname.to_ascii_lowercase();
    match Host::parse(&lower) {
        Ok(Host::Ipv4(ip)) => {
            let [a, b, ..] = ip.octets();
            a == 10 || a == 127 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168) || (a == 169 && b == 254) || (a == 100 && (64..=127).contains(&b))
        }
        Ok(Host::Ipv6(ip)) => ip.is_loopback() || ip.segments()[0] & 0xfe00 == 0xfc00,
        _ => lower == "localhost" || lower.ends_with(".localhost") || PRIVATE_HOST_SUFFIXES.iter().any(|suffix| lower.ends_with(suffix)),
    }
}

fn insecure_http_warning(hostname: &str) -> String {
    let base = i18n::t("Warnung: Dieser Remote nutzt HTTP ohne TLS. Der Datenverkehr kann von jedem auf dem Weg mitgelesen oder verändert werden.");
    if is_private_hostname(hostname) {
        format!("{base} {}", i18n::t("Nur fortfahren, wenn du dem lokalen oder privaten Netz vertraust, über das diese Verbindung läuft."))
    } else {
        format!("{base} {}", i18n::t("Dieser Host liegt in keinem erkannten privaten Netz, das Risiko ist also höher."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_path_and_keeps_the_https_origin() {
        let normalized = normalize_remote_url("https://paperclip.example.com/app/dashboard?x=1#top").unwrap();
        assert_eq!(normalized.normalized_url, "https://paperclip.example.com/");
        assert_eq!(normalized.origin, "https://paperclip.example.com");
        assert!(!normalized.insecure_transport);
        assert_eq!(normalized.warning, None);
    }

    #[test]
    fn allows_http_remotes_with_an_insecurity_warning() {
        let ten_net = normalize_remote_url("http://10.0.1.25:3100").unwrap();
        assert_eq!(ten_net.normalized_url, "http://10.0.1.25:3100/");
        assert_eq!(ten_net.origin, "http://10.0.1.25:3100");
        assert!(ten_net.insecure_transport);
        assert!(ten_net.warning.unwrap().contains("ohne TLS"));

        let ip_address = normalize_remote_url("http://192.168.1.50:3100/dashboard").unwrap();
        assert_eq!(ip_address.normalized_url, "http://192.168.1.50:3100/");
        assert_eq!(ip_address.origin, "http://192.168.1.50:3100");

        let tailnet = normalize_remote_url("http://paperclip-host.tailnet.ts.net").unwrap();
        assert_eq!(tailnet.normalized_url, "http://paperclip-host.tailnet.ts.net/");
        assert_eq!(tailnet.origin, "http://paperclip-host.tailnet.ts.net");
        assert!(tailnet.warning.unwrap().contains("privaten Netz vertraust"));

        let public_host = normalize_remote_url("http://paperclip.example.com").unwrap();
        assert_eq!(public_host.normalized_url, "http://paperclip.example.com/");
        assert!(public_host.warning.unwrap().contains("Risiko ist also höher"));
    }

    #[test]
    fn rejects_embedded_credentials_and_other_schemes() {
        assert!(normalize_remote_url("https://user:pass@paperclip.example.com").unwrap_err().contains("Benutzername"));
        assert!(normalize_remote_url("ftp://paperclip.example.com").unwrap_err().contains("HTTP oder HTTPS"));
        assert_eq!(normalize_remote_url("  ").unwrap_err(), INVALID_URL);
        assert_eq!(normalize_remote_url("paperclip.example.com").unwrap_err(), INVALID_URL);
    }

    #[test]
    fn recognises_tailnet_and_private_address_hosts() {
        assert!(is_private_hostname("paperclip-host.tailnet.ts.net"));
        assert!(is_private_hostname("10.0.1.25"));
        assert!(is_private_hostname("192.168.1.50"));
        assert!(is_private_hostname("100.100.100.100"));
        assert!(is_private_hostname("[::1]"));
        assert!(is_private_hostname("[fd00::1]"));
        assert!(!is_private_hostname("paperclip.example.com"));
        assert!(!is_private_hostname("fdroid.example.com"));
    }
}
