use std::time::Duration;

use ureq::tls::{RootCerts, TlsConfig};

pub struct HttpResponse {
    pub status: u16,
    pub content_type: String,
    pub body: String,
}

impl HttpResponse {
    pub fn is_json(&self) -> bool {
        self.content_type.to_ascii_lowercase().contains("application/json")
    }

    pub fn json(&self) -> Result<serde_json::Value, String> {
        serde_json::from_str(&self.body).map_err(|e| e.to_string())
    }
}

/// A GET for JSON that never follows redirects, so a probe stays on the origin it was asked about.
pub trait Fetch {
    fn get(&self, url: &str, timeout: Duration) -> Result<HttpResponse, String>;
}

/// `cookie` carries a window's session, so a probe sees what the window is signed in as.
#[derive(Default)]
pub struct UreqFetch {
    pub cookie: Option<String>,
}

impl Fetch for UreqFetch {
    fn get(&self, url: &str, timeout: Duration) -> Result<HttpResponse, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .max_redirects(0)
            .max_redirects_will_error(false)
            .http_status_as_error(false)
            // The Windows certificate store, so the probe trusts what the webview trusts.
            .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).build())
            .build()
            .into();
        let mut request = agent.get(url).header("accept", "application/json");
        if let Some(cookie) = &self.cookie {
            request = request.header("cookie", cookie);
        }
        let mut response = request.call().map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default().to_owned();
        let mut result = HttpResponse { status, content_type, body: String::new() };
        if result.is_json() {
            result.body = response.body_mut().with_config().limit(1024 * 1024).read_to_string().map_err(|e| e.to_string())?;
        }
        Ok(result)
    }
}

#[cfg(test)]
pub mod testing {
    use std::cell::RefCell;
    use std::collections::VecDeque;

    use super::*;

    /// Answers the probes in order and records the URLs asked for.
    #[derive(Default)]
    pub struct FakeFetch {
        pub responses: RefCell<VecDeque<Result<HttpResponse, String>>>,
        pub calls: RefCell<Vec<String>>,
    }

    impl FakeFetch {
        pub fn new(responses: Vec<Result<HttpResponse, String>>) -> Self {
            Self { responses: RefCell::new(responses.into()), calls: RefCell::default() }
        }
    }

    impl Fetch for FakeFetch {
        fn get(&self, url: &str, _timeout: Duration) -> Result<HttpResponse, String> {
            self.calls.borrow_mut().push(url.to_owned());
            self.responses.borrow_mut().pop_front().expect("an unexpected probe")
        }
    }

    pub fn json_response(body: serde_json::Value, status: u16) -> Result<HttpResponse, String> {
        Ok(HttpResponse { status, content_type: "application/json".into(), body: body.to_string() })
    }
}
