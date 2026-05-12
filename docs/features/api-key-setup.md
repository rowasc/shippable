# API Key Setup

## What it is
The desktop-app onboarding flow for enabling AI-backed features. Lives in the unified `CredentialsPanel` — boot mode for the missing-key prompt, settings mode for the management surface opened from the topbar gear or the Welcome footer.

## What it does
- Prompts for an Anthropic API key at first launch when no credential is configured. Persistent skip (`localStorage`) suppresses the prompt on subsequent launches; the workspace topbar and Welcome header surface an "AI off" chip so the dismissal stays visible.
- Lets the user skip and stay on rule-based behavior; the bundled server still runs (worktrees, prompt library, rule-based plan) without a key — only the AI-generated plan and streaming review are gated.
- Stores the key in macOS Keychain on the desktop app; the web app reads it via the Tauri shell at boot and pushes it to the server's in-memory auth-store. No app restart is required — the server reads from the store on every AI call.
- Settings (gear in the workspace topbar, link in the Welcome footer) lets the user rotate or clear the Anthropic key and any number of per-host GitHub PATs. New non-`github.com` hosts go through the host-trust interstitial first.

## Screenshots
![API key setup](./assets/key-setup.png)

![API key saved](./assets/key-setup-saved.png)
