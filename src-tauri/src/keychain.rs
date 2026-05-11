//! Keychain bridge. Service name is the app namespace (`"shippable"`); the
//! account names are the credential identifiers (e.g. `"ANTHROPIC_API_KEY"`).
//!
//! IMPORTANT: relies on the `apple-native` feature of the `keyring` crate.
//! Without that feature keyring 3.x falls back to an in-memory mock store —
//! `set_password` succeeds but nothing persists past process exit. Make sure
//! `Cargo.toml` carries `features = ["apple-native", ...]`.
//!
//! How it works:
//! - `Entry::new(service, account)` resolves one native Keychain item.
//! - `SERVICE` is fixed to the app namespace (`"shippable"`), so every caller
//!   is operating inside the same credential bucket.
//! - `account` identifies the specific secret in that bucket, such as
//!   `"ANTHROPIC_API_KEY"`.
//! - The Tauri commands below validate the requested account name first, then
//!   forward to the native Keychain through `keyring`.

use keyring::{Entry, Error};

const SERVICE: &str = "shippable";

fn validate_account(account: &str) -> Result<(), String> {
    if account == "ANTHROPIC_API_KEY" {
        return Ok(());
    }

    if let Some(host) = account.strip_prefix("GITHUB_TOKEN:") {
        if is_allowed_github_host(host) {
            return Ok(());
        }
    }

    Err(format!("account name '{account}' is not allowed"))
}

fn is_allowed_github_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }

    let host = host.to_ascii_lowercase();
    if host == "localhost"
        || host.contains(':')
        || host.contains('/')
        || host.contains('\\')
        || host.contains('@')
        || host.starts_with('.')
        || host.ends_with('.')
    {
        return false;
    }

    if host.chars().all(|c| c.is_ascii_digit() || c == '.') {
        let Some(octets) = parse_ipv4(&host) else {
            return false;
        };
        return !is_blocked_ipv4(octets);
    }

    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
}

fn parse_ipv4(host: &str) -> Option<[u8; 4]> {
    let octets = host
        .split('.')
        .map(str::parse::<u8>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if octets.len() != 4 {
        return None;
    }
    Some([octets[0], octets[1], octets[2], octets[3]])
}

fn is_blocked_ipv4(octets: [u8; 4]) -> bool {
    let [a, b, _, _] = octets;
    a == 10
        || a == 0
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || a >= 224
}

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

/// Internal accessor for other Rust modules. `Ok(None)` means the entry is
/// genuinely missing; `Err` means a real failure (denied access, etc.).
pub fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
/// Frontend-safe wrapper around `get`. The allowlist keeps the webview from
/// probing arbitrary Keychain accounts through the Tauri bridge.
pub fn keychain_get(account: String) -> Result<Option<String>, String> {
    validate_account(&account)?;
    get(&account)
}

#[tauri::command]
/// Stores or overwrites the named credential in the app's Keychain service.
pub fn keychain_set(account: String, password: String) -> Result<(), String> {
    validate_account(&account)?;
    entry(&account)?
        .set_password(&password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
/// Deletes the named credential. Missing entries are treated as already-clean.
pub fn keychain_remove(account: String) -> Result<(), String> {
    validate_account(&account)?;
    match entry(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::validate_account;

    #[test]
    fn allows_the_anthropic_key_account() {
        assert!(validate_account("ANTHROPIC_API_KEY").is_ok());
    }

    #[test]
    fn allows_github_token_accounts_for_domains() {
        assert!(validate_account("GITHUB_TOKEN:github.com").is_ok());
        assert!(validate_account("GITHUB_TOKEN:ghe.example.com").is_ok());
        assert!(validate_account("GITHUB_TOKEN:GitHub.EXAMPLE.com").is_ok());
    }

    #[test]
    fn rejects_unknown_accounts() {
        assert!(validate_account("OPENAI_API_KEY").is_err());
        assert!(validate_account("GITHUB_TOKEN:").is_err());
    }

    #[test]
    fn rejects_github_token_accounts_with_path_or_userinfo() {
        assert!(validate_account("GITHUB_TOKEN:example.com/path").is_err());
        assert!(validate_account("GITHUB_TOKEN:user@example.com").is_err());
        assert!(validate_account("GITHUB_TOKEN:example.com\\path").is_err());
    }

    #[test]
    fn rejects_local_or_private_hosts() {
        for host in [
            "localhost",
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "fd00::1",
        ] {
            assert!(validate_account(&format!("GITHUB_TOKEN:{host}")).is_err());
        }
    }

    #[test]
    fn rejects_malformed_domain_labels() {
        for host in [
            ".example.com",
            "example.com.",
            "bad..example.com",
            "-bad.example.com",
            "bad-.example.com",
            "999.999.999.999",
        ] {
            assert!(validate_account(&format!("GITHUB_TOKEN:{host}")).is_err());
        }
    }
}
