use std::collections::BTreeMap;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};

use crate::i18n;

const API: &str = "https://api.github.com";
/// The catalog the app ships as a snapshot; the search leaves it out.
const CATALOG_REPOSITORY: &str = "paperclipai/companies";
/// Packages read in one GraphQL query.
const BATCH: usize = 15;
/// Agents whose `AGENTS.md` one GraphQL query reads.
const AGENT_BATCH: usize = 100;
/// GitHub's code search hands out at most ten pages of a hundred.
const PAGES: usize = 10;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A company package somewhere on GitHub, found by its `COMPANY.md`.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub repository: String,
    /// The folder of the `COMPANY.md`, empty at the repository's root.
    pub folder: String,
    /// What Paperclip imports the package from.
    pub url: String,
    /// The package's `slug`, which a copy of a catalog package shares with it.
    pub slug: String,
    pub name: String,
    pub description: String,
    pub stars: u64,
    /// When the repository was last pushed to, as YYYY-MM-DD.
    pub updated: String,
    /// One per folder below `agents`.
    pub agents: Vec<FoundAgent>,
    /// The folders below `skills` and `teams`: one per skill and team.
    pub skills: usize,
    pub teams: usize,
    /// The avatar of the repository's owner, a URL on GitHub.
    pub avatar: Option<String>,
}

/// An agent of a found package, as far as its hierarchy needs it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundAgent {
    /// The agent's folder below `agents`.
    pub slug: String,
    /// The slug of the agent it reports to, as its `AGENTS.md` names it.
    pub reports_to: Option<String>,
}

/// The token for GitHub's search, kept in the Windows credential store under a name of this app's data folder,
/// so a test run with its own folder never sees the real one.
pub mod token {
    use std::path::Path;

    use windows_sys::Win32::Security::Credentials::{CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW};

    fn target(user_data: &Path) -> Vec<u16> {
        format!("PaperclipDesk:github:{}", user_data.display()).encode_utf16().chain([0]).collect()
    }

    pub fn read(user_data: &Path) -> Option<String> {
        let target = target(user_data);
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return None;
            }
            let blob = std::slice::from_raw_parts((*credential).CredentialBlob, (*credential).CredentialBlobSize as usize);
            let token = String::from_utf8(blob.to_vec()).ok();
            CredFree(credential.cast());
            token.filter(|token| !token.is_empty())
        }
    }

    pub fn write(user_data: &Path, token: &str) -> Result<(), String> {
        let mut target = target(user_data);
        let mut blob = token.as_bytes().to_vec();
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = blob.len() as u32;
        credential.CredentialBlob = blob.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }

    pub fn delete(user_data: &Path) {
        let target = target(user_data);
        unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
    }
}

#[derive(Deserialize)]
struct CodeResults {
    items: Vec<CodeItem>,
}

#[derive(Deserialize)]
struct CodeItem {
    path: String,
    repository: CodeRepository,
}

#[derive(Deserialize)]
struct CodeRepository {
    full_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Package {
    stargazer_count: u64,
    owner: Option<Owner>,
    pushed_at: Option<String>,
    description: Option<String>,
    default_branch_ref: Option<BranchRef>,
    company: Option<Blob>,
    agents: Option<Folder>,
    skills: Option<Folder>,
    teams: Option<Folder>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Owner {
    avatar_url: String,
}

#[derive(Deserialize)]
struct BranchRef {
    name: String,
}

#[derive(Deserialize)]
struct Blob {
    text: Option<String>,
}

#[derive(Deserialize)]
struct Folder {
    entries: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    r#type: String,
}

impl Folder {
    fn folders(folder: Option<&Self>) -> impl Iterator<Item = &str> {
        folder.into_iter().flat_map(|folder| folder.entries.iter().filter(|entry| entry.r#type == "tree").map(|entry| entry.name.as_str()))
    }
}

fn failed(e: ureq::Error) -> String {
    match e {
        ureq::Error::StatusCode(401) => i18n::t("GitHub hat das Token abgelehnt.").to_owned(),
        ureq::Error::StatusCode(403 | 429) => i18n::t("GitHub lässt gerade keine weiteren Suchen zu; bitte später erneut versuchen.").to_owned(),
        e => i18n::f("GitHub antwortet nicht: {}", &[&e]),
    }
}

/// GitHub names owners and repositories with these characters only; anything else does not go into a query or a URL.
fn plain(name: &str) -> bool {
    !name.is_empty() && !name.starts_with("..") && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn plain_repository(repository: &str) -> bool {
    repository.split_once('/').is_some_and(|(owner, name)| plain(owner) && plain(name))
}

/// The head of a repository's default branch: its commit, the day it was made, and every file with its Git blob SHA.
#[derive(Serialize)]
pub struct Branch {
    commit: String,
    /// YYYY-MM-DD.
    date: String,
    files: Vec<BranchFile>,
}

#[derive(Serialize)]
pub struct BranchFile {
    path: String,
    blob: String,
    size: u64,
}

#[derive(Deserialize)]
struct Commit {
    sha: String,
    commit: CommitDetails,
}

#[derive(Deserialize)]
struct CommitDetails {
    committer: Committer,
}

#[derive(Deserialize)]
struct Committer {
    date: String,
}

#[derive(Deserialize)]
struct Tree {
    tree: Vec<TreeEntry>,
}

#[derive(Deserialize)]
struct TreeEntry {
    path: String,
    r#type: String,
    sha: String,
    #[serde(default)]
    size: u64,
}

fn rest<T: DeserializeOwned>(agent: &ureq::Agent, token: Option<&str>, path: &str) -> Result<T, String> {
    let request = agent.get(format!("{API}/{path}")).header("User-Agent", "PaperclipDesk").header("Accept", "application/vnd.github+json");
    let request = match token {
        Some(token) => request.header("Authorization", format!("Bearer {token}")),
        None => request,
    };
    request.call().map_err(failed)?.body_mut().with_config().limit(50 * 1024 * 1024).read_json().map_err(failed)
}

/// Reads the head of `repository`'s default branch, with the user's token when there is one; GitHub allows a few reads without.
pub fn branch(repository: &str, token: Option<&str>) -> Result<Branch, String> {
    if !plain_repository(repository) {
        return Err(i18n::t("Diese Vorlage gibt es nicht.").to_owned());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(60))).build().into();
    let head: Commit = rest(&agent, token, &format!("repos/{repository}/commits/HEAD"))?;
    let tree: Tree = rest(&agent, token, &format!("repos/{repository}/git/trees/{}?recursive=1", head.sha))?;
    let files = tree.tree.into_iter().filter(|entry| entry.r#type == "blob").map(|entry| BranchFile { path: entry.path, blob: entry.sha, size: entry.size }).collect();
    Ok(Branch { commit: head.sha, date: head.commit.committer.date.chars().take(10).collect(), files })
}

/// A file of a repository with what its content must hash to.
#[derive(Deserialize)]
pub struct PinnedFile {
    path: String,
    #[serde(flatten)]
    checksum: Checksum,
}

/// The SHA-256 the app's snapshot recorded, or the Git blob SHA the tree of the commit names.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Checksum {
    Sha256(String),
    Blob(String),
}

impl Checksum {
    fn matches(&self, bytes: &[u8]) -> bool {
        match self {
            Self::Sha256(sum) => format!("{:x}", Sha256::digest(bytes)).eq_ignore_ascii_case(sum),
            Self::Blob(sha) => format!("{:x}", Sha1::new().chain_update(format!("blob {}\0", bytes.len())).chain_update(bytes).finalize()).eq_ignore_ascii_case(sha),
        }
    }
}

/// Requests in flight at once for the files of a collection.
const FILE_THREADS: usize = 8;

/// The files of a repository at one commit, each checked against its checksum, so a company gets nothing but what the
/// snapshot or the branch read before saw. Text comes as a string, anything else encoded like a binary file of a package.
pub fn pinned_files(repository: &str, commit: &str, files: &[PinnedFile]) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let wrong = || i18n::t("Diese Vorlage gibt es nicht.").to_owned();
    let plain_path = |path: &str| path.split('/').all(|part| plain(part) && part != ".");
    if !plain_repository(repository) || commit.len() != 40 || !commit.chars().all(|c| c.is_ascii_hexdigit()) || !files.iter().all(|file| plain_path(&file.path)) {
        return Err(wrong());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(60))).build().into();
    let fetch = |file: &PinnedFile| -> Result<(String, serde_json::Value), String> {
        let bytes = agent.get(format!("https://raw.githubusercontent.com/{repository}/{commit}/{}", file.path)).header("User-Agent", "PaperclipDesk").call().map_err(failed)?.body_mut().with_config().limit(10 * 1024 * 1024).read_to_vec().map_err(failed)?;
        if !file.checksum.matches(&bytes) {
            return Err(i18n::f("{} von GitHub stimmt nicht mit seiner Prüfsumme überein.", &[&file.path]));
        }
        let value = match String::from_utf8(bytes) {
            Ok(text) => serde_json::Value::from(text),
            Err(binary) => serde_json::json!({ "encoding": "base64", "data": BASE64.encode(binary.as_bytes()) }),
        };
        Ok((file.path.clone(), value))
    };
    let chunk = files.len().div_ceil(FILE_THREADS).max(1);
    std::thread::scope(|scope| {
        let workers = files.chunks(chunk).map(|part| scope.spawn(move || part.iter().map(fetch).collect::<Result<Vec<_>, _>>())).collect::<Vec<_>>();
        let mut out = serde_json::Map::new();
        for worker in workers {
            out.extend(worker.join().map_err(|_| wrong())??);
        }
        Ok(out)
    })
}

/// The part of the GraphQL query that reads one package: the repository's facts, its `COMPANY.md` and the folders of its agents, skills and teams.
fn package_query(alias: &str, repository: &str, folder: &str) -> Option<String> {
    let at = |path: &str| file(folder, path);
    let entries = |key: &str| format!("{key}: object(expression: {}) {{ ... on Tree {{ entries {{ name type }} }} }}", at(key));
    Some(format!(
        "{alias}: {} {{ stargazerCount owner {{ avatarUrl(size: 48) }} pushedAt description defaultBranchRef {{ name }} company: object(expression: {}) {{ ... on Blob {{ text }} }} {} {} {} }}",
        repository_node(repository, folder)?,
        at("COMPANY.md"),
        entries("agents"),
        entries("skills"),
        entries("teams"),
    ))
}

/// The part of the GraphQL query that reads the `AGENTS.md` of one agent of a package.
fn agent_query(alias: &str, repository: &str, folder: &str, agent: &str) -> Option<String> {
    plain(agent).then_some(())?;
    Some(format!("{alias}: {} {{ object(expression: {}) {{ ... on Blob {{ text }} }} }}", repository_node(repository, folder)?, file(folder, &format!("agents/{agent}/AGENTS.md"))))
}

fn repository_node(repository: &str, folder: &str) -> Option<String> {
    let (owner, name) = repository.split_once('/').filter(|(owner, name)| plain(owner) && plain(name))?;
    (folder.is_empty() || folder.split('/').all(plain)).then(|| format!("repository(owner: \"{owner}\", name: \"{name}\")"))
}

/// A file of the package in `folder`, as a quoted object expression.
fn file(folder: &str, path: &str) -> String {
    serde_json::Value::from(format!("HEAD:{}", if folder.is_empty() { path.to_owned() } else { format!("{folder}/{path}") })).to_string()
}

/// The agent a `reportsTo` names: its slug, or the folder of the `AGENTS.md` it points to.
fn boss(reference: &str) -> String {
    reference.strip_suffix("/AGENTS.md").map_or(reference, |path| path.rsplit('/').next().unwrap_or(path)).to_owned()
}

/// Reads the parts of a GraphQL query in batches side by side, since GitHub gives up on one query that reads too much.
fn graphql(agent: &ureq::Agent, token: &str, parts: &[String], batch: usize) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let answers = std::thread::scope(|scope| {
        let batches = parts
            .chunks(batch)
            .map(|batch| {
                let body = serde_json::json!({ "query": format!("{{ {} }}", batch.join(" ")) });
                scope.spawn(move || -> Result<serde_json::Value, String> {
                    let mut answer: serde_json::Value = agent.post(format!("{API}/graphql")).header("Authorization", format!("Bearer {token}")).header("User-Agent", "PaperclipDesk").send_json(body).map_err(failed)?.body_mut().read_json().map_err(failed)?;
                    Ok(answer["data"].take())
                })
            })
            .collect::<Vec<_>>();
        batches.into_iter().map(|batch| batch.join().unwrap_or_else(|_| Err(String::new()))).collect::<Result<Vec<_>, _>>()
    })?;
    let mut data = serde_json::Map::new();
    for answer in answers {
        if let serde_json::Value::Object(answer) = answer {
            data.extend(answer);
        }
    }
    Ok(data)
}

/// The value of `key` in a Markdown file's front matter, following YAML's block scalars as far as a description needs.
fn field(markdown: &str, key: &str) -> Option<String> {
    let body = markdown.strip_prefix("---")?.trim_start_matches(['\r', '\n']);
    let block = &body[..body.find("\n---")?];
    let mut lines = block.lines();
    let first = lines.by_ref().find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))?.trim();
    let value = if first.is_empty() || matches!(first.chars().next(), Some('>' | '|')) {
        lines.take_while(|line| line.starts_with([' ', '\t']) || line.trim().is_empty()).map(str::trim).collect::<Vec<_>>().join(" ")
    } else {
        first.to_owned()
    };
    let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim().to_owned();
    (!value.is_empty()).then_some(value)
}

/// The words of a search; qualifiers stay out, so a search cannot widen itself beyond company packages.
fn words(query: &str) -> String {
    query.split_whitespace().filter(|word| !word.contains(':')).collect::<Vec<_>>().join(" ")
}

/// The same search on GitHub's website, whose newer index also knows repositories the API's search misses.
pub fn search_page(query: &str) -> String {
    let q = format!(r#"path:/(^|\/)COMPANY\.md$/ "agentcompanies/v1" {}"#, words(query));
    url::Url::parse_with_params("https://github.com/search", [("q", q.trim()), ("type", "code")]).map(String::from).unwrap_or_default()
}

/// The files GitHub's code search finds for `q`, as many pages as it hands out.
fn code_search(agent: &ureq::Agent, token: &str, q: &str) -> Result<Vec<CodeItem>, String> {
    let page = |page: usize| -> Result<Vec<CodeItem>, String> {
        let results: CodeResults = agent
            .get(format!("{API}/search/code"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "PaperclipDesk")
            .query("q", q.trim())
            .query("per_page", "100")
            .query("page", page.to_string())
            .call()
            .map_err(failed)?
            .body_mut()
            .read_json()
            .map_err(failed)?;
        Ok(results.items)
    };
    let mut items = page(1)?;
    // A later page GitHub refuses, mostly for its limit of searches per minute, leaves the pages read so far.
    let mut last = items.len();
    for number in 2..=PAGES {
        if last < 100 {
            break;
        }
        let Ok(more) = page(number) else { break };
        last = more.len();
        items.extend(more);
    }
    Ok(items)
}

/// Searches GitHub for company packages; `query` narrows the search, empty finds them all as far as GitHub's code search goes.
pub fn search(token: &str, query: &str) -> Result<Vec<Found>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
    let items = code_search(&agent, token, &format!("filename:COMPANY.md \"agentcompanies/v1\" {}", words(query)))?;

    let mut packages = BTreeMap::new();
    for item in items {
        let Some(folder) = item.path.strip_suffix("COMPANY.md").filter(|folder| folder.is_empty() || folder.ends_with('/')) else { continue };
        if !item.repository.full_name.eq_ignore_ascii_case(CATALOG_REPOSITORY) {
            packages.insert((item.repository.full_name, folder.trim_end_matches('/').to_owned()), ());
        }
    }
    let packages = packages.into_keys().enumerate().filter_map(|(index, (repository, folder))| Some((package_query(&format!("p{index}"), &repository, &folder)?, format!("p{index}"), repository, folder))).collect::<Vec<_>>();
    if packages.is_empty() {
        return Ok(Vec::new());
    }

    let mut data = graphql(&agent, token, &packages.iter().map(|(query, ..)| query.clone()).collect::<Vec<_>>(), BATCH)?;
    let packages = packages
        .into_iter()
        .filter_map(|(_, alias, repository, folder)| {
            let package: Package = serde_json::from_value(data.remove(&alias)?).ok()?;
            let agents = Folder::folders(package.agents.as_ref()).map(str::to_owned).collect::<Vec<_>>();
            (!agents.is_empty()).then_some((repository, folder, package, agents))
        })
        .collect::<Vec<_>>();

    // Who reports to whom is only in each agent's AGENTS.md.
    let parts = packages.iter().enumerate().flat_map(|(p, (repository, folder, _, agents))| agents.iter().enumerate().filter_map(move |(a, name)| agent_query(&format!("p{p}a{a}"), repository, folder, name))).collect::<Vec<_>>();
    let mut texts = graphql(&agent, token, &parts, AGENT_BATCH)?;
    let mut reports_to = |alias: String| {
        let answer = texts.remove(&alias)?;
        field(answer["object"]["text"].as_str()?, "reportsTo").map(|reference| boss(&reference))
    };

    Ok(packages
        .into_iter()
        .enumerate()
        .filter_map(|(p, (repository, folder, package, agents))| {
            let agents = agents.into_iter().enumerate().map(|(a, slug)| FoundAgent { reports_to: reports_to(format!("p{p}a{a}")), slug }).collect();
            let markdown = package.company?.text?;
            let last = folder.rsplit('/').next().filter(|name| !name.is_empty()).unwrap_or_else(|| repository.rsplit('/').next().unwrap_or(&repository)).to_owned();
            let mut url = url::Url::parse(&format!("https://github.com/{repository}")).ok()?;
            url.query_pairs_mut().append_pair("ref", &package.default_branch_ref?.name).append_pair("path", &folder);
            Some(Found {
                slug: field(&markdown, "slug").unwrap_or_else(|| last.clone()),
                name: field(&markdown, "name").unwrap_or(last),
                description: field(&markdown, "description").or(package.description).unwrap_or_default(),
                stars: package.stargazer_count,
                updated: package.pushed_at.as_deref().map(|date| date.chars().take(10).collect()).unwrap_or_default(),
                agents,
                skills: Folder::folders(package.skills.as_ref()).count(),
                teams: Folder::folders(package.teams.as_ref()).count(),
                avatar: package.owner.map(|owner| owner.avatar_url),
                url: url.into(),
                repository,
                folder,
            })
        })
        .collect())
}

/// A repository with skills somewhere on GitHub, found by its `SKILL.md` files.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoundSkills {
    pub repository: String,
    pub description: String,
    pub stars: u64,
    /// When the repository was last pushed to, as YYYY-MM-DD.
    pub updated: String,
    /// The SPDX id of its licence; none when GitHub knows of none.
    pub license: Option<String>,
    /// The `SKILL.md` files the search saw; the repository may hold more.
    pub skills: usize,
    pub avatar: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillRepository {
    stargazer_count: u64,
    owner: Option<Owner>,
    pushed_at: Option<String>,
    description: Option<String>,
    license_info: Option<License>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct License {
    spdx_id: Option<String>,
}

/// Searches GitHub for repositories with skills, by the `SKILL.md` of each; `query` narrows the search.
pub fn search_skills(token: &str, query: &str) -> Result<Vec<FoundSkills>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
    let mut counts = BTreeMap::<String, usize>::new();
    for item in code_search(&agent, token, &format!("filename:SKILL.md {}", words(query)))? {
        if item.path.ends_with("/SKILL.md") {
            *counts.entry(item.repository.full_name).or_default() += 1;
        }
    }
    let repositories = counts
        .into_iter()
        .enumerate()
        .filter_map(|(index, (repository, skills))| {
            let alias = format!("r{index}");
            let query = format!("{alias}: {} {{ stargazerCount owner {{ avatarUrl(size: 48) }} pushedAt description licenseInfo {{ spdxId }} }}", repository_node(&repository, "")?);
            Some((query, alias, repository, skills))
        })
        .collect::<Vec<_>>();
    if repositories.is_empty() {
        return Ok(Vec::new());
    }
    let mut data = graphql(&agent, token, &repositories.iter().map(|(query, ..)| query.clone()).collect::<Vec<_>>(), AGENT_BATCH)?;
    Ok(repositories
        .into_iter()
        .filter_map(|(_, alias, repository, skills)| {
            let found: SkillRepository = serde_json::from_value(data.remove(&alias)?).ok()?;
            Some(FoundSkills {
                description: found.description.unwrap_or_default(),
                stars: found.stargazer_count,
                updated: found.pushed_at.as_deref().map(|date| date.chars().take(10).collect()).unwrap_or_default(),
                license: found.license_info.and_then(|license| license.spdx_id).filter(|id| id != "NOASSERTION"),
                skills,
                avatar: found.owner.map(|owner| owner.avatar_url),
                repository,
            })
        })
        .collect())
}

/// Where the token for the search comes from.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Access {
    Stored,
    Cli,
}

/// The token for the search: the one stored here, otherwise the one of the user's signed-in GitHub CLI.
pub fn access(user_data: &Path) -> Option<(String, Access)> {
    token::read(user_data).map(|token| (token, Access::Stored)).or_else(|| cli_token().map(|token| (token, Access::Cli)))
}

/// The GitHub CLI of this machine: on the PATH or where its installer puts it, for an app started before the PATH had it.
fn find_cli() -> Option<PathBuf> {
    let path = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect::<Vec<_>>()).unwrap_or_default();
    path.into_iter().chain(std::env::var_os("ProgramFiles").map(|programs| PathBuf::from(programs).join("GitHub CLI"))).map(|dir| dir.join("gh.exe")).find(|exe| exe.is_file())
}

fn cli_token() -> Option<String> {
    let output = Command::new(find_cli()?).args(["auth", "token", "--hostname", "github.com"]).stdin(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    let token = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (output.status.success() && !token.is_empty()).then_some(token)
}

#[cfg(test)]
mod tests {
    use super::{Checksum, PinnedFile, agent_query, boss, field, package_query, pinned_files, search_page};
    use crate::i18n;

    #[test]
    fn a_front_matter_field_follows_folded_values_and_quotes() {
        let markdown = "---\nname: \"Acme Labs\"\ndescription: >\n  Builds rockets\n  and tests them.\nslug: acme\n---\n\nBody";
        assert_eq!(field(markdown, "name").as_deref(), Some("Acme Labs"));
        assert_eq!(field(markdown, "description").as_deref(), Some("Builds rockets and tests them."));
        assert_eq!(field(markdown, "slug").as_deref(), Some("acme"));
        assert_eq!(field(markdown, "goals"), None);
        assert_eq!(field("no front matter", "name"), None);
    }

    #[test]
    fn only_plain_names_go_into_the_query() {
        let query = package_query("p0", "acme/agents", "packages/studio").unwrap();
        assert!(query.contains("repository(owner: \"acme\", name: \"agents\")"));
        assert!(query.contains("\"HEAD:packages/studio/COMPANY.md\""));
        assert!(package_query("p0", "acme/agents", "").unwrap().contains("\"HEAD:agents\""));
        assert!(package_query("p0", "acme\"){x}/agents", "").is_none());
        assert!(package_query("p0", "acme/agents", "a\"b").is_none());
        assert!(package_query("p0", "acme/agents", "../x").is_none());
        assert!(agent_query("a0", "acme/agents", "studio", "cto").unwrap().contains("\"HEAD:studio/agents/cto/AGENTS.md\""));
        assert!(agent_query("a0", "acme/agents", "", "c\"to").is_none());
    }

    #[test]
    fn the_search_page_keeps_to_company_packages() {
        let url = url::Url::parse(&search_page("game studio repo:x/y")).unwrap();
        let q = url.query_pairs().find(|(key, _)| key == "q").unwrap().1.into_owned();
        assert_eq!(q, r#"path:/(^|\/)COMPANY\.md$/ "agentcompanies/v1" game studio"#);
        assert_eq!(url.host_str(), Some("github.com"));
    }

    #[test]
    fn a_boss_is_named_by_slug_or_by_the_path_of_its_agents_md() {
        assert_eq!(boss("ceo"), "ceo");
        assert_eq!(boss("agents/ceo/AGENTS.md"), "ceo");
        assert_eq!(boss("../ceo/AGENTS.md"), "ceo");
        assert_eq!(boss("../../COMPANY.md"), "../../COMPANY.md");
    }

    #[test]
    fn a_blob_checksum_is_the_sha_git_gives_the_file() {
        let blob = |sha: &str| Checksum::Blob(sha.to_owned());
        assert!(blob("ce013625030ba8dba906f756967f9e9ca394464a").matches(b"hello\n"));
        assert!(!blob("ce013625030ba8dba906f756967f9e9ca394464a").matches(b"hello"));
        assert!(Checksum::Sha256("5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03".to_owned()).matches(b"hello\n"));
    }

    #[test]
    fn pinned_files_stay_in_the_repository_and_commit_they_name() {
        let commit = "0123456789abcdef0123456789abcdef01234567";
        let file = |path: &str| PinnedFile { path: path.to_owned(), checksum: Checksum::Sha256(String::new()) };
        let refused = Err(i18n::t("Diese Vorlage gibt es nicht.").to_owned());
        assert_eq!(pinned_files("acme/agents", commit, &[file("skills/../../other/SKILL.md")]), refused);
        assert_eq!(pinned_files("acme/agents", commit, &[file("skills/./SKILL.md")]), refused);
        assert_eq!(pinned_files("acme/agents", "main", &[file("SKILL.md")]), refused);
        assert_eq!(pinned_files("acme", commit, &[file("SKILL.md")]), refused);
        assert_eq!(pinned_files("acme/agents?x=1", commit, &[file("SKILL.md")]), refused);
        assert_eq!(pinned_files("acme/agents", commit, &[]), Ok(serde_json::Map::new()));
    }
}

