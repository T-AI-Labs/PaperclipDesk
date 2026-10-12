use crate::i18n;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};

/// The Paperclip server this build of the app runs, as pinned in package.json.
pub const VERSION: &str = env!("PAPERCLIP_SERVER_VERSION");
/// The package's SHA-256; only a release build knows it, and nothing is downloaded without it.
const SHA256: Option<&str> = option_env!("PAPERCLIP_SERVER_SHA256");
const RELEASES: &str = "https://github.com/T-AI-Labs/PaperclipDesk/releases/download";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where this version of the server lives once it has been downloaded.
pub fn installed_dir(packages: &Path) -> PathBuf {
    packages.join(VERSION)
}

pub fn can_download() -> bool {
    SHA256.is_some()
}

fn url() -> String {
    format!("{RELEASES}/server-v{VERSION}/paperclip-server-{VERSION}-win-x64.zip")
}

/// Downloads the server package, checks it against the checksum built into the app and unpacks it.
/// `progress` gets the bytes so far and the total; `cancelled` ends the download early.
pub fn install(packages: &Path, progress: impl Fn(u64, Option<u64>), cancelled: impl Fn() -> bool) -> Result<(), String> {
    let expected = SHA256.ok_or(i18n::t("Dieser Build kann den Paperclip-Server nicht nachladen. Im Repository legt „npm run prepare-server“ ihn an."))?;
    std::fs::create_dir_all(packages).map_err(|e| format!("{}: {e}", packages.display()))?;
    let archive = packages.join(format!("{VERSION}.zip.part"));
    let unpacking = packages.join(format!("{VERSION}.unpacking"));

    let result = download(&archive, &progress, &cancelled).and_then(|digest| {
        if !digest.eq_ignore_ascii_case(expected) {
            return Err(i18n::t("Das heruntergeladene Server-Paket ist beschädigt (Prüfsumme stimmt nicht).").to_string());
        }
        progress(0, None);
        unpack(&archive, &unpacking)?;
        std::fs::rename(&unpacking, installed_dir(packages)).map_err(|e| i18n::f("Das Server-Paket ließ sich nicht entpacken: {}", &[&e]))
    });
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_dir_all(&unpacking);
    result?;
    remove_other_versions(packages);
    Ok(())
}

fn download(archive: &Path, progress: &impl Fn(u64, Option<u64>), cancelled: &impl Fn() -> bool) -> Result<String, String> {
    let failed = |e: &dyn std::fmt::Display| i18n::f("Der Paperclip-Server ließ sich nicht herunterladen: {}", &[&e]);
    let mut response = ureq::get(url()).call().map_err(|e| failed(&e))?;
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

/// Windows' own tar reads zip archives; naming it by path keeps another `tar` on the PATH out of it.
fn unpack(archive: &Path, target: &Path) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(target);
    std::fs::create_dir_all(target).map_err(|e| format!("{}: {e}", target.display()))?;
    let tar = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into())).join("System32").join("tar.exe");
    let status = Command::new(tar).arg("-xf").arg(archive).arg("-C").arg(target).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW).status();
    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(i18n::f("Das Server-Paket ließ sich nicht entpacken: {}", &[&status])),
        Err(e) => Err(i18n::f("Das Server-Paket ließ sich nicht entpacken: {}", &[&e])),
    }
}

fn remove_other_versions(packages: &Path) {
    for entry in std::fs::read_dir(packages).into_iter().flatten().flatten() {
        if entry.file_name() != VERSION {
            let _ = if entry.path().is_dir() { std::fs::remove_dir_all(entry.path()) } else { std::fs::remove_file(entry.path()) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_package_is_named_after_the_pinned_server_version() {
        assert!(!VERSION.is_empty());
        assert!(url().ends_with(&format!("/server-v{VERSION}/paperclip-server-{VERSION}-win-x64.zip")));
        assert_eq!(installed_dir(Path::new(r"C:\data")), Path::new(r"C:\data").join(VERSION));
    }

    #[test]
    fn older_versions_are_removed_after_an_install() {
        let packages = std::env::temp_dir().join(format!("paperclipdesk-packages-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(packages.join("2020.1.0").join("server")).unwrap();
        std::fs::create_dir_all(installed_dir(&packages)).unwrap();
        std::fs::write(packages.join("old.zip.part"), "x").unwrap();
        remove_other_versions(&packages);
        assert_eq!(std::fs::read_dir(&packages).unwrap().count(), 1);
        assert!(installed_dir(&packages).is_dir());
        std::fs::remove_dir_all(&packages).unwrap();
    }
}
