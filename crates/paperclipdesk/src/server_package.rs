use crate::i18n;
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The Paperclip server this build of the app is tested with, as pinned in package.json.
pub const VERSION: &str = env!("PAPERCLIP_SERVER_VERSION");
/// The pinned package's SHA-256; only a release build knows it.
const SHA256: Option<&str> = option_env!("PAPERCLIP_SERVER_SHA256");
/// The public half of the key that signs the list of server versions, from `server-catalog.pub`.
const PUBLIC_KEY: &str = env!("PAPERCLIPDESK_SERVER_CATALOG_PUBKEY");
const RELEASES: &str = "https://github.com/T-AI-Labs/PaperclipDesk/releases/download";
const CATALOG: &str = "server-catalog/server-versions.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A server package the app may download, with the SHA-256 the download must have.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Package {
    pub version: String,
    pub sha256: String,
}

#[derive(Deserialize)]
struct Catalog {
    versions: Vec<Package>,
}

/// Where a version of the server lives once it has been downloaded.
pub fn installed_dir(packages: &Path, version: &str) -> PathBuf {
    packages.join(version)
}

/// The version to run: the one the user chose, unless this build is tested with a newer one. Never an older one, which
/// would not start on a database a newer server has migrated.
pub fn wanted(chosen: Option<&str>) -> String {
    chosen.filter(|chosen| is_newer(chosen, VERSION)).unwrap_or(VERSION).to_owned()
}

pub fn is_newer(version: &str, than: &str) -> bool {
    let parts = |version: &str| version.split('.').map(|part| part.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parts(version).cmp(&parts(than)) == Ordering::Greater
}

/// A version as Paperclip's releases name them, with nothing in it that leaves a URL or a folder.
pub fn is_version(version: &str) -> bool {
    version.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// The pinned package, which a release build can fetch without asking GitHub for its checksum.
pub fn pinned_package() -> Option<Package> {
    SHA256.map(|sha256| Package { version: VERSION.to_owned(), sha256: sha256.to_owned() })
}

/// The server versions published for the app, from the list signed with the key in `server-catalog.pub`.
pub fn catalog() -> Result<Vec<Package>, String> {
    let failed = |e: &dyn std::fmt::Display| i18n::f("Die Liste der Server-Versionen ließ sich nicht laden: {}", &[&e]);
    let fetch = |path: &str| ureq::get(format!("{RELEASES}/{path}")).call().map_err(|e| failed(&e))?.body_mut().read_to_string().map_err(|e| failed(&e));
    let list = fetch(CATALOG)?;
    verify(&list, &fetch(&format!("{CATALOG}.sig"))?, PUBLIC_KEY)?;
    let catalog: Catalog = serde_json::from_str(&list).map_err(|e| failed(&e))?;
    Ok(catalog.versions.into_iter().filter(|package| is_version(&package.version)).collect())
}

/// Checks a minisign signature the way the updater does: key and signature are base64 of minisign's own text form.
fn verify(data: &str, signature: &str, public_key: &str) -> Result<(), String> {
    let decode = |text: &str| base64::engine::general_purpose::STANDARD.decode(text.trim()).ok().and_then(|bytes| String::from_utf8(bytes).ok());
    let key = decode(public_key).and_then(|key| PublicKey::decode(&key).ok());
    let signature = decode(signature).and_then(|signature| Signature::decode(&signature).ok());
    match (key, signature) {
        (Some(key), Some(signature)) if key.verify(data.as_bytes(), &signature, true).is_ok() => Ok(()),
        _ => Err(i18n::t("Die Liste der Server-Versionen ist nicht richtig signiert.").to_owned()),
    }
}

fn url(version: &str) -> String {
    format!("{RELEASES}/server-v{version}/paperclip-server-{version}-win-x64.zip")
}

/// Downloads the server package, checks it against its checksum and unpacks it; the other versions go afterwards.
/// `progress` gets the bytes so far and the total; `cancelled` ends the download early.
pub fn install(packages: &Path, package: &Package, progress: impl Fn(u64, Option<u64>), cancelled: impl Fn() -> bool) -> Result<(), String> {
    let version = &package.version;
    std::fs::create_dir_all(packages).map_err(|e| format!("{}: {e}", packages.display()))?;
    let archive = packages.join(format!("{version}.zip.part"));
    let unpacking = packages.join(format!("{version}.unpacking"));

    let result = download(&url(version), &archive, &progress, &cancelled).and_then(|digest| {
        if !digest.eq_ignore_ascii_case(&package.sha256) {
            return Err(i18n::t("Das heruntergeladene Server-Paket ist beschädigt (Prüfsumme stimmt nicht).").to_string());
        }
        progress(0, None);
        unpack(&archive, &unpacking).map_err(|e| i18n::f("Das Server-Paket ließ sich nicht entpacken: {}", &[&e]))?;
        std::fs::rename(&unpacking, installed_dir(packages, version)).map_err(|e| i18n::f("Das Server-Paket ließ sich nicht entpacken: {}", &[&e]))
    });
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_dir_all(&unpacking);
    result?;
    remove_other_versions(packages, version);
    Ok(())
}

fn download(url: &str, archive: &Path, progress: &impl Fn(u64, Option<u64>), cancelled: &impl Fn() -> bool) -> Result<String, String> {
    let failed = |e: &dyn std::fmt::Display| i18n::f("Der Paperclip-Server ließ sich nicht herunterladen: {}", &[&e]);
    let mut response = ureq::get(url).call().map_err(|e| failed(&e))?;
    let total = response.headers().get("content-length").and_then(|value| value.to_str().ok()).and_then(|value| value.parse::<u64>().ok());
    let mut reader = response.body_mut().with_config().limit(u64::MAX).reader();
    let mut file = std::fs::File::create(archive).map_err(|e| failed(&e))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut done = 0u64;
    loop {
        if cancelled() {
            return Err(i18n::t("Abgebrochen.").into());
        }
        let read = reader.read(&mut buffer).map_err(|e| failed(&e))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).map_err(|e| failed(&e))?;
        done += read as u64;
        progress(done, total);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Windows' own tar reads zip archives; naming it by path keeps another `tar` on the PATH out of it. The error says only
/// what went wrong, the caller says with what.
pub fn unpack(archive: &Path, target: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(target);
    std::fs::create_dir_all(target).map_err(|e| format!("{}: {e}", target.display()))?;
    let tar = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into())).join("System32").join("tar.exe");
    let status = Command::new(tar).arg("-xf").arg(archive).arg("-C").arg(target).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW).status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(status.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

fn remove_other_versions(packages: &Path, keep: &str) {
    for entry in std::fs::read_dir(packages).into_iter().flatten().flatten() {
        if entry.file_name() != keep {
            let _ = if entry.path().is_dir() { std::fs::remove_dir_all(entry.path()) } else { std::fs::remove_file(entry.path()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_is_named_after_its_version() {
        assert!(url("2026.1023.0").ends_with("/server-v2026.1023.0/paperclip-server-2026.1023.0-win-x64.zip"));
        assert_eq!(installed_dir(Path::new(r"C:\data"), "2026.1023.0"), Path::new(r"C:\data").join("2026.1023.0"));
    }

    #[test]
    fn versions_compare_by_their_numbers_and_never_go_back() {
        assert!(is_newer("2026.1023.0", "2026.916.1"));
        assert!(is_newer("2026.1001.1", "2026.1001.0"));
        assert!(!is_newer("2026.1001.0", "2026.1001.0"));
        assert_eq!(wanted(None), VERSION);
        assert_eq!(wanted(Some("2020.1.0")), VERSION);
        assert_eq!(wanted(Some("9999.1.0")), "9999.1.0");
    }

    #[test]
    fn only_plain_version_numbers_are_versions() {
        assert!(is_version("2026.1023.0"));
        for wrong in ["", "2026..0", "2026.1023.0-beta.1", "../2026", "2026/1023", "v2026.1023.0"] {
            assert!(!is_version(wrong), "{wrong}");
        }
    }

    #[test]
    fn the_list_must_carry_a_signature_of_the_catalog_key() {
        // Both made with `tauri signer sign`: one by the key in server-catalog.pub, one by a throwaway key.
        let signed = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSTE5ZOXNzTmRCTFJ1dlRtVkc5dW9ucFk1MEcwMlZGd3VmK0wxOUs4TUs3MW1qQi9IaldvQm9SRGdMVTNtWHVSTlJ1VE9peTdaQW8vcTdoQ2pKR0t6c3crbWx4c0VUVXdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyOTkzNjcwCWZpbGU6cmVhbC5qc29uCmUvb0hKNEtzOUYxbERhemJtYVA0RkQ4YkdYRC85Z3RYTmJhbjl2US9zQlhCRlNPUnJYam1PbEVPU05QVXBMeTlMUTBzZ3phdE5UUHFTS3ZEdVBHWURRPT0K";
        let other_key = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRU0YrSnNJdTA1elNwb2JMeWFMZk9SNmdoL1hMMm9CeHFjbW5pSmptM2gvaGp1Vk9FSFg2TGQrS0cvQ1FFdmVzdERKU1ZYWFQ0R1ZpRmpaenNQK3FrMGZaUlB0c05ZSFFFPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyOTkyNjk1CWZpbGU6bGlzdC5qc29uCjZ0MmtjbTZDTmd3ZFo3NTRDd2hqWTdNNVRkQ3JYRGdNS3RqVWprZ2NwbDM3NkM4REEzUmdQa3lOL1haT281M21uY0taMGRsUnN4TFpkZUpGS3BqakFBPT0K";
        let list = r#"{"versions":[{"version":"2026.1023.0","sha256":"ab"}]}"#;
        assert!(verify(list, signed, PUBLIC_KEY).is_ok());
        assert!(verify(&list.replace("ab", "cd"), signed, PUBLIC_KEY).is_err());
        assert!(verify(list, other_key, PUBLIC_KEY).is_err());
        assert!(verify(list, "not base64", PUBLIC_KEY).is_err());
    }

    #[test]
    fn other_versions_are_removed_after_an_install() {
        let packages = std::env::temp_dir().join(format!("paperclipdesk-packages-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(packages.join("2020.1.0").join("server")).unwrap();
        std::fs::create_dir_all(installed_dir(&packages, VERSION)).unwrap();
        std::fs::write(packages.join("old.zip.part"), "x").unwrap();
        remove_other_versions(&packages, VERSION);
        assert_eq!(std::fs::read_dir(&packages).unwrap().count(), 1);
        assert!(installed_dir(&packages, VERSION).is_dir());
        std::fs::remove_dir_all(&packages).unwrap();
    }
}
