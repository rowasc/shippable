# API Key Flows Refinement — Requirements

## Goal

Unify the Anthropic key and GitHub-token flows under one pattern: a single generic auth endpoint, a generic server-side auth-store, and a Settings surface that lets users manage credentials post-onboarding. Remove the Anthropic restart-to-apply friction (hot-reload via the new endpoint) and persist the skip choice so first-run prompts don't return on every launch. The architecture has to degrade cleanly across all three deployment shapes flagged in `AGENTS.md` (Tauri desktop / local dev / future hosted backend), which means the server never reads OS credential storage directly — the web app orchestrates, the Tauri Rust shell remains the only Keychain client.

## Requirements

1. **Single generic auth endpoint.** Replace `/api/github/auth/{set,has,clear}` with `/api/auth/{set,has,clear,list}`. Each endpoint takes a `credential` discriminator — `{kind: "anthropic"}` or `{kind: "github", host}` — so the same surface handles both credential types. The `list` endpoint returns the set of configured credentials (identifiers only — never the secret values) so the Settings UI can render what's configured.

2. **Generic server-side auth-store.** Generalize `server/src/github/auth-store.ts` into a credential store keyed by a discriminator (e.g., `"anthropic"` or `"github:<host>"`). All set/has/get/clear operations go through it. The GitHub host blocklist (private IPs, localhost, etc. — see `auth-store.ts` `BLOCKED`) continues to apply on the `github` branch.

3. **Tauri Rust shell remains the only Keychain client.** The web app calls existing `keychain_get`/`keychain_set`/`keychain_remove` Tauri commands; the server never touches OS credential storage. This is the same pattern used today for GitHub, generalized.

4. **Sidecar drops the Anthropic env-read.** Remove `process.env.ANTHROPIC_API_KEY` from the AI-endpoint gates (`/api/plan`, `/api/review`) and from the `/api/health` reporter. They consult the auth-store instead. The Tauri shell stops passing the key as an env var at spawn (`src-tauri/src/lib.rs`); the per-spawn Keychain read also goes away.

5. **Web-app-orchestrated boot rehydrate.** On boot, for each credential the app cares about, the web app reads Keychain via the existing Tauri commands and, on a hit, calls `/auth/set` so the server caches it. The rehydrate step is **silent** — a Keychain miss does nothing. Same handshake mechanics for Anthropic and for every trusted GitHub host. Works in dev mode (no Tauri → rehydrate is a no-op; the auth-store stays empty until the user enters values explicitly).

6. **Hot-reload Anthropic.** A successful `/auth/set` for `{kind: "anthropic"}` immediately enables the AI endpoints. No `saved-pending-restart` state; the UI flips from "prompt" to "ready" the moment the server confirms. Same behavior for GitHub (already true today).

7. **Settings surface.** A new in-app Settings panel lists configured credentials (Anthropic + one row per configured GitHub host). Per row: **Rotate** (re-prompt + save, overwrites Keychain + server) and **Clear** (removes from Keychain + server). The list is populated from `/api/auth/list` plus Keychain enumeration via existing Tauri commands. No "test" / probe button — see Requirement 11.

8. **Add-GitHub-host action.** Settings exposes an "Add GitHub host" action that lets the user pre-configure a GHE host before pasting any PR URL. Routes through the existing GHE host-trust interstitial (`web/src/githubHostTrust.ts`) on the first add for a non-`github.com` host. Anthropic doesn't need an equivalent "Add" — there's exactly one slot, and Rotate-on-empty covers Set.

9. **Persistent Anthropic skip.** When the user clicks "Skip — use rule-based only," the choice persists in `localStorage` (e.g., `shippable:anthropic:skip`). The boot prompt does not reappear on subsequent launches. The topbar shows a subtle "AI off — click to enable" affordance that opens the Settings panel; saving a key clears the skip flag.

10. **Reactive prompting preserved for implicit cases — and is the *only* way GitHub gets prompted.** GitHub tokens are never requested at boot. When the user pastes a PR URL for a host with no token, the existing `GitHubTokenModal` appears on the `github_token_required` discriminator. Same for `github_auth_failed` → rejected-state re-prompt. Anthropic, by contrast, *is* prompted at boot when missing-and-not-skipped (Requirement 9). Settings is the proactive escape hatch for both kinds; the reactive GitHub prompt is unchanged in flow, just plumbed through the new `/api/auth/*` endpoints.

11. **No token validation.** Trust the credential at the boundary; let the first real API call surface failures. No `/v1/models` probe for Anthropic, no `/user` probe for GitHub. Aligns with `AGENTS.md` "trust the boundary."

12. **GHE host-trust interstitial preserved.** The recent hardening (commit `f00e1c3`) stays in place — a non-`github.com` host shown for the first time triggers the trust prompt with the resolved API destination. Wired into both the reactive `GitHubTokenModal` and the new Settings "Add GitHub host" action.

13. **`/api/health` reports auth-store state.** Currently `anthropic: "present" | "missing"` reflects `process.env.ANTHROPIC_API_KEY`. After this refinement it reflects the auth-store. May extend to report GitHub-host presence too (sdd-spec can decide; arguably `/api/auth/list` is the right place for that and `/health` stays minimal).

14. **No protocol/wire change for credential values.** Tokens still travel only over the localhost loopback (web ↔ server) and over TLS to provider APIs. Validation at the server boundary (host shape, credential kind) stays.

## Constraints

- **macOS-only Keychain today.** The Tauri shell's `keyring` crate is feature-locked to `apple-native`; this refinement does not unlock other platforms. The web-app-orchestrated pattern keeps the cross-platform door open without committing to it now.
- **Local server binds `127.0.0.1`.** Same posture as today.
- **No new transports.** REST only. No MCP server, no IPC channel between Tauri shell and sidecar beyond the existing spawn relationship.
- **Tauri `keychain_*` command surface stays.** Existing allowlist (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN:<host>` with host validation per `src-tauri/src/keychain.rs`) is unchanged.
- **Single PAT per GitHub host.** Carry over from `gh-connectivity` — no multi-account on the same host.
- **AGENTS.md "trust the boundary."** Validate credential discriminator and host shape at the server edge; don't re-validate internal calls.
- **Existing fixtures and persisted `ReviewState` rehydrate cleanly.** No localStorage schema migration required.

## Out of Scope

- **Token validation on save.** No Anthropic `/v1/models` probe, no GitHub `/user` probe. Failed real calls drive the re-prompt.
- **OAuth / GitHub App authentication.** PAT only.
- **Cross-platform Keychain.** Stays macOS-only via Tauri's `keyring` crate with `apple-native`. Dropping that feature lock is a separate change.
- **Multi-account per GitHub host.** Single PAT per host; rotation overwrites.
- **Sidecar env-read fallback.** Once removed, the sidecar no longer consults `process.env.ANTHROPIC_API_KEY`. No env-var-driven mode survives this refinement.
- **Dev-mode GitHub token persistence.** Dev/browser mode keeps server-memory-only storage for both credentials — lost on server restart. No `~/.shippable/dev-auth.json` or similar. Re-prompt is acceptable for the dev loop.
- **Sidecar reading Keychain directly** (via `@napi-rs/keyring`, shelling out to `security`, or an IPC channel back to the Tauri shell). Rejected — see brainstorm rationale: the hosted-backend deployment shape can't rely on OS credential storage, so the architecture standardizes on "server never reads OS storage."
- **Background revalidation / expiry detection.** No periodic probe; tokens are trusted until a real call rejects them.
- **Credential export / backup UI.** Settings can rotate and clear; it can't view the value or export it.
- **Per-credential metadata** (last-used timestamp, scopes summary, etc.). Possibly a future polish item; out of v0.

## Open Questions

(Resolve in sdd-spec.)

- **Endpoint body shape.** Exact JSON for the credential discriminator on `/auth/{set,has,clear}`. Candidate: `{ credential: { kind: "anthropic" } | { kind: "github", host: string }, value?: string }`. Spec to confirm names, validation rules, and error discriminators.
- **`/api/health` extent.** Does `health` keep reporting `anthropic: present|missing` for the boot gate, or does the boot gate switch entirely to `/api/auth/has`? Probably the latter (single source of truth) — spec to decide.
- **Settings UI location.** Topbar gear icon, a `/settings` route, or a modal slide-in from the existing topbar? Should match the codebase's existing modal/route conventions.
- **`ApiKeyStatus` collapse.** `useApiKey.ts` carries an Anthropic-specific state machine. Likely collapses into a generic credential hook (or two thin wrappers — one for Anthropic, one for GH host) backed by `/api/auth/*`. Spec to pick the shape and decide whether `KeySetup.tsx`'s `mode="shell"` variant is removed entirely (likely yes — dev mode now paste-to-server).
- **Skip-flag scope.** Is the persistent skip strictly per-key (`shippable:anthropic:skip`), or does it generalize (e.g., a future "skip GitHub setup" idea)? Anthropic-only for v0 unless a use case appears.
- **Topbar "AI off" affordance shape.** Chip, dot, hover hint? Out-of-band placement to avoid noise. Spec to mock.
- **Boot-time prompt vs Settings-only.** With persistent skip, do we still show the Anthropic boot prompt on a fresh first run? Yes — the prompt drives the initial Set; subsequent skip persists. Confirm wording.
- **Migration for existing users.** A user upgrading from a build that wrote `ANTHROPIC_API_KEY` to Keychain (today's setup) should not need to re-enter. The boot handshake covers this automatically (`/auth/has` → false → `keychain_get` → hit → `/auth/set`). Spec to verify no edge case is missed (e.g., a user who only ever had the env var set, no Keychain entry).
- **`/api/auth/list` payload shape.** Identifier-only, never the value. Candidate: `{ credentials: Array<{ kind: "anthropic" } | { kind: "github", host: string }> }`. Spec to confirm; consider also whether trusted-but-unset GH hosts (from `githubHostTrust.ts` localStorage) show up as "configured-host candidates" in the Settings list.
- **Cleanup of `/api/github/auth/*`.** Drop entirely on the new endpoint, or keep as thin aliases for one release? Internal-only API per `AGENTS.md` — likely a clean replacement, no aliases.

## Related Code / Patterns Found

### Anthropic flow (existing)
- `web/src/useApiKey.ts` — Anthropic-specific React hook with the `ApiKeyStatus` state machine; encapsulates the Tauri-vs-browser split. Becomes the basis (or is replaced by) a generic credential hook backed by `/api/auth/*`.
- `web/src/components/KeySetup.tsx` — boot-time Anthropic prompt with `mode="keychain"` and `mode="shell"`. The `shell` variant disappears (dev users paste in the same way as Tauri users; the server endpoint handles persistence-by-deployment).
- `web/src/components/ServerHealthGate.tsx` — orchestrates `/api/health` + Anthropic key check. Switches to consulting `/api/auth/has` for Anthropic. The "AI off" topbar affordance hooks into the same state.
- `server/src/index.ts` lines ~148–158, ~187–192, ~257–263, ~1545–1553 — `/api/health` and AI-endpoint env-presence gates. All move to the auth-store.
- `src-tauri/src/lib.rs` `start_sidecar` — reads Keychain and sets `ANTHROPIC_API_KEY` env on spawn. Both reads can be removed; the web app handles boot rehydrate.
- `src-tauri/src/keychain.rs` — Tauri keychain commands and validation. Unchanged; the existing `ANTHROPIC_API_KEY` allowlist entry remains valid.

### GitHub flow (existing — pattern to generalize)
- `server/src/github/auth-store.ts` — in-memory `Map<host, token>` with host blocklist. Generalized: same shape, but keyed by `"anthropic"` or `"github:<host>"`. The blocklist continues to apply on the `github:*` branch only.
- `server/src/index.ts` lines ~107–115 — handlers for `/api/github/auth/{set,has,clear}`. Replaced with the generic `/api/auth/*` handlers (the GH-specific routes go away).
- `web/src/githubPrClient.ts` — `setGithubToken` and the `github_token_required` / `github_auth_failed` error discriminators. Stays; the call target switches from `/api/github/auth/set` to `/api/auth/set` with the right discriminator body.
- `web/src/useGithubPrLoad.ts` — the reactive prompt orchestration (cache-hit retry, modal open on token-required, rejected re-prompt). Unchanged in flow; the underlying server calls are renamed.
- `web/src/components/GitHubTokenModal.tsx` — reactive modal with first-time/rejected modes and the inline GHE host-trust interstitial. Stays as the reactive surface; reused (or sibling-composed) by the new Settings "Add GitHub host" flow.
- `web/src/githubHostTrust.ts` — `localStorage`-backed trusted-host list; `readTrustedGithubHosts` / `trustGithubHost`. Unchanged; consumed by both reactive modal and Settings "Add".
- `web/src/keychain.ts` — `isTauri()`, `keychainGet`, `keychainSet`. Already credential-agnostic; consumed by both flows.

### Server endpoint surface
- `server/src/index.ts` `classifyRequestOrigin` path — new `/api/auth/*` endpoints plug into the same origin allowlist + opaque-origin denial; no exception.
- `docs/concepts/server-api-boundary.md` — surface list to update.

### SDD precedent
- `docs/sdd/gh-connectivity/spec.md` — defines the two-tier active/durable token model and the lazy-rehydrate handshake that this refinement generalizes. The "Token model" section is the direct prior art.
- `docs/sdd/gh-connectivity/requirements.md` — single-source-of-load-affordances thread (`useLoadSurface()`) — same de-duplication principle motivates collapsing `useApiKey` / `useGithubPrLoad` orchestration onto one shape.

### Recent context (commits)
- `999f93b` — server boots without Anthropic key; `/api/health` reports presence. Establishes the "graceful degradation" pattern this refinement extends.
- `583788c` — Anthropic key picked up from Keychain, not the shell env that may have leaked through. This refinement removes the env path entirely; the fix's intent is preserved (single source of truth) and tightened.
- `c4c868c` — Tauri reset-button no-op fix (unrelated to auth, but lives next door in the topbar surface where the "AI off" affordance may land).
- `f00e1c3` — GHE host-trust hardening; the dynamic-account validation in `src-tauri/src/keychain.rs` and the trust interstitial in `GitHubTokenModal`. All preserved.
