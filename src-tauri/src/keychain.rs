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

const ALLOWED_ACCOUNTS: &[&str] = &["ANTHROPIC_API_KEY"];

fn validate_account(account: &str) -> Result<(), String> {
    if ALLOWED_ACCOUNTS.contains(&account) {
        Ok(())
    } else {
        Err(format!("account name '{account}' is not allowed"))
    }
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
