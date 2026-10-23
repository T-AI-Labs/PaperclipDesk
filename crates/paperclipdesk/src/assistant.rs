use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::i18n;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// A proposal for a large company takes a minute or so; a CLI that hangs must not keep the wizard waiting for ever.
const TIMEOUT: Duration = Duration::from_secs(300);
/// The setting that lets the wizards ask Claude through the user's Claude Code; anything else keeps the assistant off.
pub const CLAUDE_CODE: &str = "claude_code";
const SYSTEM: &str = "You help people set up companies of AI agents in Paperclip. You answer with exactly one JSON object and nothing else: no prose, no code fences.";

/// The Claude Code CLI of this machine, as its native installer puts it: on the PATH or in ~/.local/bin.
pub fn find() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect::<Vec<_>>()).unwrap_or_default();
    path.into_iter().chain(dirs::home_dir().map(|home| home.join(".local").join("bin"))).map(|dir| dir.join("claude.exe")).find(|exe| exe.is_file())
}

#[derive(Deserialize)]
struct Answer {
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
}

/// Asks Claude through the user's signed-in Claude Code and returns its answer. It runs without tools, without the user's
/// settings and hooks, and in an empty folder, so it sees nothing but the prompt; it counts against the user's subscription.
pub fn ask(claude: &Path, prompt: &str) -> Result<String, String> {
    let failed = |e: &dyn std::fmt::Display| i18n::f("Claude Code antwortet nicht: {}", &[&e]);
    let folder = std::env::temp_dir().join("paperclipdesk-assistant");
    std::fs::create_dir_all(&folder).map_err(|e| failed(&e))?;
    let mut child = Command::new(claude)
        .args(["-p", "--output-format", "json", "--no-session-persistence", "--tools", "", "--setting-sources", "", "--model", "sonnet", "--system-prompt", SYSTEM])
        .current_dir(&folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| failed(&e))?;

    // The prompt carries the whole catalog; written while the output is read, neither pipe can fill up and stall.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let prompt = prompt.to_owned();
    let writer = std::thread::spawn(move || stdin.write_all(prompt.as_bytes()));
    let mut stdout = child.stdout.take().expect("piped stdout");
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        stdout.read_to_string(&mut out).map(|_| out)
    });
    let mut stderr = child.stderr.take().expect("piped stderr");
    let errors = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stderr.read_to_string(&mut out);
        out
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| failed(&e))? {
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(i18n::t("Claude Code hat nicht rechtzeitig geantwortet.").to_owned());
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    let _ = writer.join();
    let out = reader.join().map_err(|_| failed(&"stdout"))?.map_err(|e| failed(&e))?;
    let errors = errors.join().unwrap_or_default();
    let answer: Answer = serde_json::from_str(out.trim()).map_err(|_| failed(&if errors.trim().is_empty() { status.to_string() } else { errors.trim().to_owned() }))?;
    if answer.is_error || !status.success() {
        return Err(failed(&if answer.result.is_empty() { errors.trim().to_owned() } else { answer.result }));
    }
    Ok(answer.result)
}
