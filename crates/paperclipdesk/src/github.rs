use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::i18n;

const API: &str = "https://api.github.com";
/// The catalog the app ships as a snapshot; the search leaves it out.
const CATALOG_REPOSITORY: &str = "paperclipai/companies";
/// Packages read in one GraphQL query.
const BATCH: usize = 15;

/// A company package somewhere on GitHub, found by its `COMPANY.md`.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub repository: String,
    /// The folder of the `COMPANY.md`, empty at the repository's root.
    pub folder: String,
    /// What Paperclip imports the package from.
    pub url: String,
    pub name: String,
    pub description: String,
    pub stars: u64,
    /// When the repository was last pushed to, as YYYY-MM-DD.
    pub updated: String,
    /// The folders below `agents`, `skills` and `teams`: one per agent, skill and team.
    pub agents: usize,
    pub skills: usize,
    pub teams: usize,
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
    pushed_at: Option<String>,
    description: Option<String>,
    default_branch_ref: Option<BranchRef>,
    company: Option<Blob>,
    agents: Option<Folder>,
    skills: Option<Folder>,
    teams: Option<Folder>,
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
    r#type: String,
}

impl Folder {
    fn folders(folder: Option<&Self>) -> usize {
        folder.map_or(0, |folder| folder.entries.iter().filter(|entry| entry.r#type == "tree").count())
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

/// The part of the GraphQL query that reads one package: the repository's facts, its `COMPANY.md` and the folders of its agents, skills and teams.
fn package_query(alias: &str, repository: &str, folder: &str) -> Option<String> {
    let (owner, name) = repository.split_once('/').filter(|(owner, name)| plain(owner) && plain(name))?;
    if !folder.is_empty() && !folder.split('/').all(plain) {
        return None;
    }
    let at = |path: &str| serde_json::Value::from(format!("HEAD:{}", if folder.is_empty() { path.to_owned() } else { format!("{folder}/{path}") })).to_string();
    let entries = |key: &str| format!("{key}: object(expression: {}) {{ ... on Tree {{ entries {{ type }} }} }}", at(key));
    Some(format!(
        "{alias}: repository(owner: \"{owner}\", name: \"{name}\") {{ stargazerCount pushedAt description defaultBranchRef {{ name }} company: object(expression: {}) {{ ... on Blob {{ text }} }} {} {} {} }}",
        at("COMPANY.md"),
        entries("agents"),
        entries("skills"),
        entries("teams"),
    ))
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

/// Searches GitHub for company packages; `query` narrows the search, empty finds them all as far as one page goes.
pub fn search(token: &str, query: &str) -> Result<Vec<Found>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).build().into();
    let words = query.split_whitespace().filter(|word| !word.contains(':')).collect::<Vec<_>>().join(" ");
    let q = format!("filename:COMPANY.md \"agentcompanies/v1\" {words}");
    let results: CodeResults = agent
        .get(format!("{API}/search/code"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "PaperclipDesk")
        .query("q", q.trim())
        .query("per_page", "100")
        .call()
        .map_err(failed)?
        .body_mut()
        .read_json()
        .map_err(failed)?;

    let mut packages = BTreeMap::new();
    for item in results.items {
        let Some(folder) = item.path.strip_suffix("COMPANY.md").filter(|folder| folder.is_empty() || folder.ends_with('/')) else { continue };
        if !item.repository.full_name.eq_ignore_ascii_case(CATALOG_REPOSITORY) {
            packages.insert((item.repository.full_name, folder.trim_end_matches('/').to_owned()), ());
        }
    }
    let packages = packages.into_keys().enumerate().filter_map(|(index, (repository, folder))| Some((package_query(&format!("p{index}"), &repository, &folder)?, format!("p{index}"), repository, folder))).collect::<Vec<_>>();
    if packages.is_empty() {
        return Ok(Vec::new());
    }

    // GitHub gives up on one query for a whole page of packages, so they are read in smaller batches side by side.
    let answers = std::thread::scope(|scope| {
        let batches = packages
            .chunks(BATCH)
            .map(|batch| {
                let body = serde_json::json!({ "query": format!("{{ {} }}", batch.iter().map(|(query, ..)| query.as_str()).collect::<Vec<_>>().join(" ")) });
                let agent = &agent;
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
    Ok(packages
        .into_iter()
        .filter_map(|(_, alias, repository, folder)| {
            let package: Package = serde_json::from_value(data.remove(&alias)?).ok()?;
            let markdown = package.company?.text?;
            let mut url = url::Url::parse(&format!("https://github.com/{repository}")).ok()?;
            url.query_pairs_mut().append_pair("ref", &package.default_branch_ref?.name).append_pair("path", &folder);
            Some(Found {
                name: field(&markdown, "name").unwrap_or_else(|| folder.rsplit('/').next().filter(|name| !name.is_empty()).unwrap_or(&repository).to_owned()),
                description: field(&markdown, "description").or(package.description).unwrap_or_default(),
                stars: package.stargazer_count,
                updated: package.pushed_at.as_deref().map(|date| date.chars().take(10).collect()).unwrap_or_default(),
                agents: Folder::folders(package.agents.as_ref()),
                skills: Folder::folders(package.skills.as_ref()),
                teams: Folder::folders(package.teams.as_ref()),
                url: url.into(),
                repository,
                folder,
            })
        })
        .collect())
}

/// Whether a token is stored for the search.
pub fn has_token(user_data: &Path) -> bool {
    token::read(user_data).is_some()
}

#[cfg(test)]
mod tests {
    use super::{field, package_query};

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
    }
}

