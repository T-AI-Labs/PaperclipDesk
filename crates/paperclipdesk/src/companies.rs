use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

use serde::Deserialize;
use tauri::webview::Webview;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use windows::core::{HSTRING, w};

use crate::i18n;

/// How long the page may take to answer; until then the menu keeps the list it had.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(5);
/// A large template brings dozens of agents and hundreds of skills, which Paperclip fetches from GitHub itself.
const IMPORT_TIMEOUT: Duration = Duration::from_secs(600);
/// The catalog of ready-made companies Paperclip publishes; a template is one of its folders.
const TEMPLATES: &str = "https://github.com/paperclipai/companies/tree/main";
/// The companies the signed-in user may open, asked for the way Paperclip's own navigation asks.
const LIST: &str = "fetch('/api/companies?scope=accessible').then(r => r.ok ? r.text() : 'null')";
const SELECTED: &str = "localStorage.getItem('paperclip.selectedCompanyId')";
/// Starts the import as a job and waits for it in the page: Paperclip accepts changes only with the page's session and origin.
const IMPORT: &str = "async body => { const failed = (answer, response) => JSON.stringify({ error: answer.error ?? answer.message ?? `HTTP ${response.status}` }); const started = await fetch('/api/companies/import?async=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const accepted = await started.json().catch(() => ({})); if (!started.ok) return failed(accepted, started); for (;;) { await new Promise(done => setTimeout(done, accepted.retryAfterMs ?? 1000)); const polled = await fetch(accepted.statusUrl); const state = await polled.json().catch(() => ({})); if (!polled.ok) return failed(state, polled); if (state.job.status === 'succeeded') return JSON.stringify({ companyId: state.job.result.companyId }); if (state.job.status === 'failed') return failed(state.job.error ?? {}, polled); } }";
/// Paperclip selects the company by the first segment of its routes and remembers the last path of each company.
const SWITCH: &str = "(id, prefix) => { let path = '/dashboard'; try { path = JSON.parse(localStorage.getItem('paperclip.companyPaths') ?? '{}')[id] ?? path; } catch {} const first = path.split('/').filter(Boolean)[0] ?? ''; const target = first.toLowerCase() === prefix.toLowerCase() ? path : `/${prefix}${path.startsWith('/') ? '' : '/'}${path}`; history.pushState(null, '', target); dispatchEvent(new PopStateEvent('popstate')); }";

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: String,
    pub name: String,
    pub issue_prefix: String,
    #[serde(default)]
    status: String,
}

/// What the host knows of the companies of one Paperclip view.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Known {
    pub view: String,
    /// `None` when the page could not be asked, e.g. before the user signed in.
    pub companies: Option<Vec<Company>>,
    /// The first segment of the page's path, which is the prefix of the company it shows.
    pub current: Option<String>,
}

impl Known {
    pub fn current_company(&self) -> Option<&Company> {
        let prefix = self.current.as_deref()?;
        self.companies.as_ref()?.iter().find(|company| company.issue_prefix.eq_ignore_ascii_case(prefix))
    }
}

/// Reads the companies through the page, so its session stays in the webview. Must not run on the main thread, which answers.
pub fn read(webview: &Webview) -> Known {
    let companies = evaluate(webview, LIST, ANSWER_TIMEOUT).as_deref().and_then(parse);
    let prefix = |company: &Company| company.issue_prefix.clone();
    let in_path = webview.url().ok().and_then(|url| url.path_segments()?.next().map(str::to_owned)).filter(|segment| companies.iter().flatten().any(|company| company.issue_prefix.eq_ignore_ascii_case(segment)));
    // Right after a start the path names no company yet; Paperclip then shows the one it selected last.
    let current = in_path.or_else(|| evaluate(webview, SELECTED, ANSWER_TIMEOUT).and_then(|id| companies.iter().flatten().find(|company| company.id == id).map(prefix)));
    Known { view: webview.label().to_owned(), companies, current }
}

/// Switches the page to the company and waits until Paperclip has taken the route, so a list read afterwards sees it in front.
pub fn switch(webview: &Webview, company: &Company) -> bool {
    let expression = format!("({SWITCH})({}, {}); 'ok'", serde_json::Value::from(company.id.as_str()), serde_json::Value::from(company.issue_prefix.as_str()));
    evaluate(webview, &expression, ANSWER_TIMEOUT).is_some()
}

/// Loads the page anew on the company's dashboard: Paperclip keeps the list of companies it started with, so one made since needs a fresh page.
pub fn reopen(webview: &Webview, company: &Company) {
    let _ = webview.eval(format!("location.assign({})", serde_json::Value::from(format!("/{}/dashboard", company.issue_prefix))));
}

/// Imports a template of the catalog as a new company and returns its id. `secrets` fills the template's environment inputs;
/// Paperclip stores them as secrets, the app keeps nothing of them.
pub fn import(webview: &Webview, template: &str, name: Option<&str>, secrets: &HashMap<String, String>) -> Result<String, String> {
    // The folder goes into a URL; the catalog names its folders in lowercase letters, digits and dashes.
    if template.is_empty() || !template.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(i18n::t("Diese Vorlage gibt es nicht.").to_owned());
    }
    let body = serde_json::json!({
        "source": { "type": "github", "url": format!("{TEMPLATES}/{template}") },
        "target": { "mode": "new_company", "newCompanyName": name.map(str::trim).filter(|name| !name.is_empty()) },
        "secretValues": secrets,
    });
    let answer = evaluate(webview, &format!("({IMPORT})({body})"), IMPORT_TIMEOUT).ok_or_else(|| i18n::t("Paperclip hat nicht rechtzeitig geantwortet.").to_owned())?;
    imported(&answer)
}

fn imported(answer: &str) -> Result<String, String> {
    let answer: serde_json::Value = serde_json::from_str(answer).map_err(|e| e.to_string())?;
    if let Some(error) = answer["error"].as_str() {
        return Err(error.to_owned());
    }
    answer["companyId"].as_str().map(str::to_owned).ok_or_else(|| i18n::t("Paperclip hat nicht rechtzeitig geantwortet.").to_owned())
}

fn parse(json: &str) -> Option<Vec<Company>> {
    let companies: Vec<Company> = serde_json::from_str(json).ok()?;
    // The prefix goes into a path the host navigates to, and Paperclip makes it of letters and digits only.
    Some(companies.into_iter().filter(|company| company.status != "archived" && !company.issue_prefix.is_empty() && company.issue_prefix.chars().all(|c| c.is_ascii_alphanumeric())).collect())
}

/// Runs `expression` in the page and waits for the promise it returns, which WebView2's ExecuteScript would not.
fn evaluate(webview: &Webview, expression: &str, timeout: Duration) -> Option<String> {
    let (sender, receiver) = mpsc::channel();
    let parameters = HSTRING::from(serde_json::json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }).to_string());
    webview
        .with_webview(move |platform| {
            let answer = sender.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                let _ = answer.send(result.ok().map(|()| json));
                Ok(())
            }));
            let called = unsafe { platform.controller().CoreWebView2().and_then(|core| core.CallDevToolsProtocolMethod(w!("Runtime.evaluate"), &parameters, &handler)) };
            if called.is_err() {
                let _ = sender.send(None);
            }
        })
        .ok()?;
    let response = receiver.recv_timeout(timeout).ok().flatten()?;
    serde_json::from_str::<serde_json::Value>(&response).ok()?.pointer("/result/value")?.as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archived_companies_and_odd_prefixes_are_left_out() {
        let json = r#"[
            {"id":"a","name":"Acme","issuePrefix":"ACME","status":"active"},
            {"id":"b","name":"Old","issuePrefix":"OLD","status":"archived"},
            {"id":"c","name":"Odd","issuePrefix":"a/../b","status":"active"}
        ]"#;
        assert_eq!(parse(json).unwrap().into_iter().map(|company| company.id).collect::<Vec<_>>(), ["a"]);
    }

    #[test]
    fn an_import_answers_with_the_new_company_or_paperclips_error() {
        assert_eq!(imported(r#"{"companyId":"c-1"}"#), Ok("c-1".to_owned()));
        assert_eq!(imported(r#"{"error":"Required environment values are missing: GH_TOKEN"}"#), Err("Required environment values are missing: GH_TOKEN".to_owned()));
    }

    #[test]
    fn a_refused_list_is_unknown() {
        assert_eq!(parse("null"), None);
    }

    #[test]
    fn the_current_company_follows_the_prefix_in_any_case() {
        let known = Known { view: "paperclip-1".into(), companies: parse(r#"[{"id":"a","name":"Acme","issuePrefix":"ACME"}]"#), current: Some("acme".into()) };
        assert_eq!(known.current_company().map(|company| company.name.as_str()), Some("Acme"));
    }
}
