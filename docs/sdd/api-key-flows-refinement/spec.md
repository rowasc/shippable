# Spec: API Key Flows Refinement

## Goal

Unify the Anthropic-key and GitHub-PAT flows under one server-side store, one HTTP surface, and one orchestrating hook on the web app. Add a Settings modal so users can rotate or clear credentials post-onboarding, persist the Anthropic skip choice so first-run prompts don't return on every launch, and remove the restart-to-apply friction by letting `/api/auth/set` take effect immediately. The Tauri Rust shell remains the only Keychain client; the server never reads OS credential storage, which keeps the architecture compatible with the local-dev and future hosted-backend deployment shapes that `AGENTS.md` flags.

## Requirements Summary

- Single generic `/api/auth/{set,has,clear,list}` endpoint with a credential discriminator `{kind: "anthropic"} | {kind: "github", host}`. Replaces `/api/github/auth/*` outright.
- Generic server-side `auth-store` keyed by an internal flat id (`"anthropic"` or `"github:<host>"`); replaces today's GH-only one.
- Sidecar stops reading `process.env.ANTHROPIC_API_KEY`. All AI-endpoint gates and `/api/health` consult the auth-store. Tauri shell stops env-seeding the sidecar at spawn.
- Web app drives a boot rehydrate handshake: read Keychain via existing Tauri commands → POST `/auth/set`. Same handshake for Anthropic and every trusted GitHub host.
- Settings modal: lists configured credentials with Rotate / Clear, plus an "Add GitHub host" action. No probe/test button. Opened from a topbar gear and a Welcome-screen link.
- Anthropic skip persists in `localStorage` (`shippable:anthropic:skip`). Topbar "AI off" affordance opens Settings when Anthropic is missing-and-dismissed.
- GHE host-trust interstitial (`githubHostTrust.ts`) is preserved and shared between the reactive `GitHubTokenModal` and the new Settings "Add" flow.
- Reactive prompting for the implicit PR-load flow continues to work; the only change is the underlying server call name.

Full detail in `requirements.md`.

## Chosen Approach

**Generalize the GH connectivity pattern (brainstorm Option A).**

The brainstorm explored three bootstrap directions: (A) Tauri Rust shell stays the Keychain client, web app orchestrates, server holds runtime state only; (B) server reads Keychain directly via `@napi-rs/keyring`; (C) hybrid — keep spawn-read for Anthropic, add a runtime override endpoint. Option A was chosen because it is the only shape that degrades cleanly across all three deployment shapes in `AGENTS.md`: Tauri desktop, local dev, and the future hosted backend (which has no Keychain at all). Option B forks the code path for hosted; Option C doesn't actually unify the two flows.

This spec turns that decision into concrete shapes for the wire format, the server-side store, the boot handshake, the Settings modal, and the topbar surface.

### Alternatives Considered

- **Option B (server reads Keychain via `@napi-rs/keyring`).** Single-source-of-truth, clean architecture, dev-mode parity. Trade-off: server can't read Keychain in the hosted-backend deployment, forcing a conditional code path; adds a native Node dep. Rejected.
- **Option C (hybrid — keep spawn-read).** Smallest blast radius. Trade-off: Anthropic stays env-seeded at spawn while GitHub stays lazy-rehydrate. Leaves pain point #1 (the inconsistency) unaddressed. Rejected.
- **Tagged-union body shape (chosen) vs. flat-id body shape.** The endpoint takes `{ credential: { kind: "anthropic" } | { kind: "github", host: string }, value? }` rather than `{ credentialId: "anthropic" | "github:<host>", value? }`. Type-safe at the boundary; future kinds slot in without re-encoding. The flat encoding is preserved *internally* as the auth-store's Map key so lookups stay O(1) and Keychain account naming stays aligned.
- **Server reports Anthropic state via `/api/health`** (today's behavior). Now collapsed into `/api/auth/has`. Single source of truth — the auth-store. `/api/health` stays minimal (`{ ok: true }`) and the boot gate consults `/auth/has` for credential state.
- **One unified Settings + boot component vs. two.** The boot KeySetup prompt and the Settings modal share enough behavior that a shared component (`CredentialsPanel`) is composed into both surfaces; the boot variant exposes "Skip", the Settings variant does not. Avoids drift between the two surfaces.
- **Eager vs lazy GitHub rehydrate at boot.** Eager: the web app iterates `readTrustedGithubHosts()` + `github.com` and pushes each Keychain hit to `/auth/set`. Lazy: do nothing at boot, let `useGithubPrLoad` rehydrate on first need. Spec picks **eager** — it makes `/api/auth/list` immediately authoritative for the Settings UI without a per-host probe step, and the cost is a handful of cheap Keychain reads at app start.

## Technical Details

### Architecture

```
┌─ Reviewer UI (web) ─────────────────────────────────────────┐
│   Boot gate (ServerHealthGate)                              │
│     - /api/health (liveness only)                           │
│     - /api/auth/has anthropic → CredentialsPanel (boot)     │
│                                  on missing-and-not-skipped │
│   Settings modal                                             │
│     - opened from topbar ⚙ and Welcome 'settings' link       │
│     - reads /api/auth/list; renders rotate / clear / add     │
│     - 'add github host' routes through GHE host-trust gate   │
│   Reactive prompts (unchanged in flow)                       │
│     - GitHubTokenModal on github_token_required / _failed    │
│   Topbar 'AI off' chip when Anthropic missing-and-dismissed  │
└────────────────┬────────────────────────────────────────────┘
                 │ Tauri keychain_get / _set / _remove
                 │ POST /api/auth/{set,clear}; GET /api/auth/has,list
                 ▼
┌─ Tauri Rust shell ──────────────────────────────────────────┐
│   keychain.rs commands (unchanged)                          │
│     allowlist: ANTHROPIC_API_KEY  |  GITHUB_TOKEN:<host>     │
│   lib.rs::start_sidecar                                      │
│     - drops the ANTHROPIC_API_KEY env-seed                   │
│     - drops the keychain::get(ANTHROPIC_KEY_ACCOUNT) read    │
└────────────────┬────────────────────────────────────────────┘
                 │ spawn (no key env)
                 ▼
┌─ Local server (server/) ────────────────────────────────────┐
│   server/src/auth/                                           │
│     store.ts   — Map<storeKey, value>; setters and getters   │
│     encode.ts  — Credential ↔ storeKey ('anthropic' /         │
│                  'github:<host>'); never re-exports values    │
│     endpoints.ts — handle /api/auth/{set,has,clear,list}      │
│   AI gates (handlePlan, handleReview) consult auth-store      │
│   /api/health: { ok: true } only                              │
│   Origin allowlist + opaque-origin denial unchanged           │
│   /api/github/* PR endpoints continue to read auth-store via  │
│     a thin getGithubToken(host) helper                        │
└──────────────────────────────────────────────────────────────┘
```

Localhost-bound; the same security posture as today. Credentials transit only the loopback (web ↔ server) and TLS (server ↔ provider).

### Data Flow

**Boot rehydrate (Tauri).**

1. `ServerHealthGate` mounts. Hits `/api/health` for liveness only.
2. App-shell hook `useCredentials.rehydrate()` runs once. **Silent — never prompts.** If a Keychain entry is missing, nothing happens; the credential simply isn't in the auth-store until something else (boot gate for Anthropic, or a reactive PR load for GitHub) drives the prompt.
   - `keychain_get('ANTHROPIC_API_KEY')`. If hit, `POST /api/auth/set { credential: { kind: "anthropic" }, value }`. If miss, do nothing.
   - For each host in `readTrustedGithubHosts()` plus the implicit `github.com`: `keychain_get('GITHUB_TOKEN:<host>')`. If hit, `POST /api/auth/set { credential: { kind: "github", host }, value }`. If miss, do nothing.
3. After rehydrate, the boot gate queries `/api/auth/has { credential: { kind: "anthropic" } }`. If `false` and `localStorage.shippable:anthropic:skip` is not `true`, render `CredentialsPanel` in boot mode (with Skip). Otherwise the gate falls through to `children`. **The boot gate only prompts for Anthropic.** Missing GitHub tokens are not surfaced at boot; they're handled by the reactive `GitHubTokenModal` on PR load, or proactively by the user via Settings.

**Boot rehydrate (dev/browser).**

1. No Tauri commands; step 2 is skipped entirely.
2. `useCredentials.rehydrate()` resolves immediately. The auth-store stays empty until the user enters keys via the Settings modal (or via the boot `CredentialsPanel` for Anthropic).
3. The shell-export instruction path (`KeySetup mode="shell"`) is removed; dev users use the same paste form as Tauri users.

**Setting / rotating a credential.**

1. User clicks Rotate (or Set on an empty Anthropic row) in the Settings modal, or pastes a new GH token in the reactive modal.
2. Web app:
   - (Tauri) `keychain_set(<account>, value)`.
   - `POST /api/auth/set { credential, value }`.
3. Server stores the new value in the auth-store map. AI endpoints (Anthropic) or GitHub fetches (GitHub) immediately see the new value on the next call. No restart.
4. If `credential.kind === "anthropic"`, web app clears `localStorage.shippable:anthropic:skip`. The topbar "AI off" chip disappears.

**Clearing a credential.**

1. User clicks Clear in the Settings modal.
2. Web app:
   - (Tauri) `keychain_remove(<account>)`.
   - `POST /api/auth/clear { credential }`.
3. Server drops the entry from the auth-store map.
4. If `credential.kind === "anthropic"` and the user clears it from Settings (not boot), the skip flag is left untouched — the user explicitly chose to remove the key, so the boot prompt should reappear next launch (unless they had previously skipped, in which case it stays skipped).

**Adding a GitHub host (Settings).**

1. User clicks "Add GitHub host", enters host (`ghe.example.com`).
2. If host is not `github.com` and not in `readTrustedGithubHosts()`, render the existing host-trust interstitial (`githubHostTrust.ts` `trustGithubHost`) with the resolved API destination.
3. After trust, render the same token-input UI as the reactive modal (paste PAT, store).
4. Submission flow identical to "setting / rotating a credential" above.

**Reactive PR-load token-required (unchanged in shape; renamed underneath).**

1. User pastes PR URL → `/api/github/pr/load` returns `github_token_required` with `host`.
2. `useGithubPrLoad` opens `GitHubTokenModal` (cache hit → retry; cache miss → prompt).
3. On submit, the modal calls `useCredentials.set({ kind: "github", host }, value)` instead of the old `setGithubToken(host, value)`. Same Keychain + auth-store path.
4. Retry the PR load.

### Key Components

#### New / modified server modules

- `server/src/auth/store.ts` (new).
  - `setCredential(credential, value)`, `hasCredential(credential)`, `getCredential(credential)`, `clearCredential(credential)`, `listCredentials(): Credential[]`.
  - Internal `Map<string, string>` keyed by `encodeStoreKey(credential)` (`"anthropic"` or `"github:<normalized-host>"`).
  - For `credential.kind === "github"`, applies the existing host blocklist (private IPs, localhost, etc. — lifted from `server/src/github/auth-store.ts`). For `anthropic`, no host validation.
- `server/src/auth/encode.ts` (new).
  - `encodeStoreKey(credential)` and `decodeStoreKey(key)` — the only place that knows the flat string form. Keeps wire/store decoupling clean.
- `server/src/auth/endpoints.ts` (new).
  - Handlers for `/api/auth/{set,has,clear,list}`. Validation: well-formed discriminator, non-empty value on `set`, non-empty host on github.kind. Errors return structured `{ error: "<discriminator>" }` payloads with 4xx codes.
- `server/src/auth/store.test.ts`, `encode.test.ts`, `endpoints.test.ts` (new).
  - Roundtrip coverage; blocklist enforcement on github branch only; encoded-key collisions ruled out (`github:anthropic` is a valid GH host but the prefix prevents collision with `anthropic`).
- `server/src/index.ts` (modify).
  - Register the four new endpoints in the origin-classification path.
  - Delete the three `/api/github/auth/*` handlers (`handleGithubAuthSet`, `handleGithubAuthHas`, `handleGithubAuthClear`). No alias.
  - `/api/health`: return `{ ok: true }` only; drop the `anthropic: "present" | "missing"` field.
  - `handlePlan`, `handleReview`, and any other AI-gate site: replace `if (!process.env.ANTHROPIC_API_KEY)` with `if (!hasCredential({ kind: "anthropic" }))`. The Anthropic SDK call site reads `getCredential({ kind: "anthropic" })` instead of relying on `process.env`.
  - Boot-time warning log (`[server] ANTHROPIC_API_KEY is not set…`): replaced with a single line at startup if `process.env.ANTHROPIC_API_KEY` is present at all, telling the dev that the env var is now ignored and to configure via Settings.
- `server/src/github/api-client.ts` (modify).
  - Replace `authStore.getToken(host)` calls with `getCredential({ kind: "github", host })`. The shape is identical; only the import changes.
- `server/src/github/auth-store.ts` (delete) and its tests (delete).
  - The functionality moves into `server/src/auth/store.ts` with the host blocklist preserved on the github branch.

#### New / modified web modules

- `web/src/auth/credential.ts` (new).
  - `type Credential = { kind: "anthropic" } | { kind: "github"; host: string }`.
  - `keychainAccountFor(c)` → `"ANTHROPIC_API_KEY"` or `"GITHUB_TOKEN:<host>"`. The single place that maps a `Credential` to its Tauri Keychain account name.
- `web/src/auth/client.ts` (new).
  - Thin fetch wrappers: `authSet(c, value)`, `authHas(c)`, `authClear(c)`, `authList()`. Throws `AuthClientError` with a `discriminator` field (mirroring `GithubFetchError`'s pattern).
- `web/src/auth/useCredentials.ts` (new).
  - Replaces `web/src/useApiKey.ts`. Surface:
    - `list: Credential[]` — synced from `/api/auth/list`, refreshed after every set/clear.
    - `status: "loading" | "ready" | "error"` — bookkeeping for the initial fetch.
    - `rehydrate(): Promise<void>` — Tauri boot handshake (Anthropic + trusted hosts). No-op in non-Tauri.
    - `set(c, value): Promise<void>` — `keychain_set` (Tauri) + `/auth/set`; on success, refreshes `list`; if `c.kind === "anthropic"`, clears the skip flag.
    - `clear(c): Promise<void>` — `keychain_remove` (Tauri) + `/auth/clear`; refreshes `list`.
    - `anthropicSkipped: boolean` — reflects `localStorage.shippable:anthropic:skip`.
    - `skipAnthropic(): void` — sets the flag (no server call).
  - One hook instance is held by the app shell (App.tsx) and exposed via React context (`CredentialsContext`) so the boot gate, topbar, Settings modal, Welcome link, and reactive `useGithubPrLoad` all observe the same state.
- `web/src/useApiKey.ts` (delete).
  - All call sites migrate to `useCredentials()` via context.
- `web/src/useGithubPrLoad.ts` (modify).
  - `setGithubToken(host, token)` call replaced with `useCredentials().set({ kind: "github", host }, token)`.
  - Cache-hit retry: `keychainGet(\`GITHUB_TOKEN:\${host}\`)` is unchanged in shape; on hit it calls `useCredentials().set` (which does the keychain + /auth/set path).
- `web/src/githubPrClient.ts` (modify).
  - Delete `setGithubToken`; that responsibility moves into the unified `auth/client.ts`.
  - `loadGithubPr` and `lookupPrForBranch` are unchanged.
- `web/src/components/CredentialsPanel.tsx` (new).
  - The shared body: header, credential list, rotate/clear actions, "Add GitHub host" button. Accepts a prop `mode: "boot" | "settings"`:
    - `boot`: shows only the Anthropic row; renders a "Skip — use rule-based only" button alongside Save.
    - `settings`: shows the full list (Anthropic + every GitHub host); no Skip button; no "saved-pending-restart" copy.
  - Internally drives off `useCredentials()`.
- `web/src/components/SettingsModal.tsx` (new).
  - Modal frame (portaled to `document.body` like `GitHubTokenModal`). Hosts `<CredentialsPanel mode="settings" />`. Close on backdrop click / Esc.
- `web/src/components/KeySetup.tsx` (delete) and `KeySetup.css` (delete).
  - Behavior absorbed into `CredentialsPanel mode="boot"`. The Anthropic-specific copy ("Shippable calls Claude…") lives in the panel.
- `web/src/components/ServerHealthGate.tsx` (modify).
  - Drop the `useApiKey()` import and the `ServerKey` state machine. Replace with: on health-ready, check `useCredentials().list` for an `anthropic` entry; if absent AND `useCredentials().anthropicSkipped` is false, render `<CredentialsPanel mode="boot" />`. Drop the `mode="shell"` branch entirely; dev users use the same panel.
- `web/src/components/GitHubTokenModal.tsx` (modify).
  - On submit, call `useCredentials().set({ kind: "github", host }, token)` instead of `setGithubToken`.
  - Host-trust interstitial unchanged.
- `web/src/components/Welcome.tsx` (modify).
  - Add a small text-link "settings" affordance (bottom-right or footer) that opens `<SettingsModal />`.
- `web/src/components/TopbarActions.tsx` (consumer change; component itself unchanged).
  - The workspace top-level (App.tsx / wherever the topbar action list is composed) gains a `settings` action (gear glyph, low priority, never pinned) that opens `<SettingsModal />`.
  - When `!useCredentials().list.some(c => c.kind === "anthropic")` AND `useCredentials().anthropicSkipped` is `true`, an additional pinned `ai-off` chip action is included (glyph "✦", label "AI off", click opens `<SettingsModal />`). When Anthropic is configured, the chip is omitted.
- `web/src/components/App.tsx` (modify).
  - Wrap children in `<CredentialsProvider>` so the hook state is shared. Run `useCredentials().rehydrate()` once on mount (Tauri only).

#### Tauri shell

- `src-tauri/src/lib.rs` (modify).
  - Delete the `keychain::get(ANTHROPIC_KEY_ACCOUNT)` block in `start_sidecar`.
  - Delete the `.env("ANTHROPIC_API_KEY", key.unwrap_or_default())` line.
  - The sidecar spawns with no key env; the web app rehydrates after boot.
- `src-tauri/src/keychain.rs` (no change).
  - Allowlist already covers `ANTHROPIC_API_KEY` and `GITHUB_TOKEN:<host>`.

### Wire shapes

```ts
// shared types (web/src/auth/credential.ts and a mirror on the server side)
type Credential =
  | { kind: "anthropic" }
  | { kind: "github"; host: string };

// POST /api/auth/set
// req:  { credential: Credential; value: string }
// res:  { ok: true }
// err:  400 { error: "invalid_credential" | "missing_value" | "host_blocked" }

// POST /api/auth/has
// req:  { credential: Credential }
// res:  { present: boolean }

// POST /api/auth/clear
// req:  { credential: Credential }
// res:  { ok: true }

// GET /api/auth/list
// res:  { credentials: Credential[] }   // identifier-only; values never returned
```

`/api/auth/has` is POST not GET because the body carries the discriminator and we want the URL to stay free of secret-bearing query strings (defensive; the value isn't sent on `has`, but consistency with `set`/`clear` matters).

### File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `server/src/auth/store.ts` | new | Generic credential store with host blocklist on github branch. |
| `server/src/auth/encode.ts` | new | `Credential ↔ storeKey` encoding. |
| `server/src/auth/endpoints.ts` | new | `/api/auth/{set,has,clear,list}` handlers. |
| `server/src/auth/store.test.ts` | new | Roundtrip + blocklist + encoding. |
| `server/src/auth/encode.test.ts` | new | Collision and parsing edge cases. |
| `server/src/auth/endpoints.test.ts` | new | Validation, error discriminators, origin handling. |
| `server/src/github/auth-store.ts` | delete | Functionality moves to `server/src/auth/store.ts`. |
| `server/src/github/auth-store.test.ts` | delete | Coverage moves to `server/src/auth/store.test.ts`. |
| `server/src/github/api-client.ts` | modify | Reads from `auth/store.ts` via `getCredential({ kind: "github", host })`. |
| `server/src/index.ts` | modify | Register `/api/auth/*`; delete `/api/github/auth/*`; collapse `/api/health` payload; replace env-checks in AI gates. |
| `server/src/index.test.ts` | modify | New endpoint coverage; updated gate tests. |
| `web/src/auth/credential.ts` | new | `Credential` type + `keychainAccountFor`. |
| `web/src/auth/client.ts` | new | `authSet/Has/Clear/List` fetch wrappers; `AuthClientError`. |
| `web/src/auth/useCredentials.ts` | new | Hook + `CredentialsContext`. |
| `web/src/useApiKey.ts` | delete | Replaced by `useCredentials`. |
| `web/src/useGithubPrLoad.ts` | modify | Switches to `useCredentials().set` for token writes. |
| `web/src/githubPrClient.ts` | modify | Delete `setGithubToken`; everything else unchanged. |
| `web/src/components/CredentialsPanel.tsx` | new | Shared body for boot + settings; rotate/clear/add UI. |
| `web/src/components/CredentialsPanel.css` | new | Styles. |
| `web/src/components/SettingsModal.tsx` | new | Modal frame around `CredentialsPanel mode="settings"`. |
| `web/src/components/KeySetup.tsx` | delete | Absorbed by `CredentialsPanel`. |
| `web/src/components/KeySetup.css` | delete | Styles move/merge into `CredentialsPanel.css`. |
| `web/src/components/ServerHealthGate.tsx` | modify | Drop `useApiKey`; consult `useCredentials`; render `CredentialsPanel mode="boot"`; drop `mode="shell"` branch. |
| `web/src/components/GitHubTokenModal.tsx` | modify | Submit through `useCredentials().set` instead of `setGithubToken`. |
| `web/src/components/Welcome.tsx` | modify | Add "settings" link that opens `SettingsModal`. |
| `web/src/components/App.tsx` | modify | Wrap in `CredentialsProvider`; rehydrate on mount; wire topbar settings + "AI off" actions. |
| `web/src/components/CredentialsPanel.test.tsx` | new | Boot + settings variants, rotate, clear, skip, add host. |
| `web/src/components/SettingsModal.test.tsx` | new | Open/close, focus trap, list rendering. |
| `web/src/components/ServerHealthGate.test.tsx` | modify (or new) | Updated for `useCredentials`-driven gate. |
| `src-tauri/src/lib.rs` | modify | Remove Anthropic Keychain read + env-seed at sidecar spawn. |
| `docs/concepts/server-api-boundary.md` | modify | Document `/api/auth/*` surface; remove `/api/github/auth/*`. |
| `docs/architecture.md` | modify | Update credential-flow section to reflect the unified pattern. |
| `docs/features/anthropic-key-setup.md` (or similar) | modify | Updated copy for the new flow; reference Settings modal. |
| `README.md` | modify | Drop the shell-export instruction for dev; describe the Settings flow. |

## Out of Scope

(Identical to requirements.md; reproduced for the implementation team.)

- Token validation on save (no Anthropic `/v1/models` or GitHub `/user` probe).
- OAuth / GitHub App authentication.
- Cross-platform Keychain (apple-native lock stays; future change).
- Multi-account per GitHub host.
- Sidecar env-read fallback.
- Dev-mode GitHub token persistence (server-memory only; re-prompt on restart is acceptable).
- Sidecar reading Keychain directly via `@napi-rs/keyring`, `security`, or an IPC channel.
- Background token revalidation / expiry detection.
- Credential export / backup UI.
- Per-credential metadata (last-used, scopes summary).

## Open Questions Resolved

- **Endpoint body shape.** Tagged-union nested under `credential` — `{ credential: { kind: "anthropic" } | { kind: "github", host: string }, value? }`. Internal store key is the flat string `"anthropic"` or `"github:<host>"`, mapped via `auth/encode.ts`. Future credential kinds slot in by extending the union; the store key prefix scheme avoids collisions.
- **`/api/health` extent.** Reduced to `{ ok: true }`. The `anthropic: "present" | "missing"` discriminator is removed; the boot gate consults `/api/auth/has` instead. Single source of truth: the auth-store.
- **Settings UI location.** Modal opened from a topbar gear (`TopbarActions` consumer-level change) and a Welcome-screen "settings" link. Sibling of `LoadModal` / `GitHubTokenModal` (portaled to `document.body`).
- **`useApiKey` collapse.** Replaced entirely by `useCredentials` + `CredentialsContext`. One hook instance lives in `App.tsx` and is consumed by the boot gate, topbar, Settings modal, Welcome link, and the reactive `useGithubPrLoad` orchestrator.
- **Skip-flag scope.** Anthropic-only in v0 (`localStorage.shippable:anthropic:skip`). GitHub has no skip concept; the user simply doesn't add a host.
- **Topbar "AI off" affordance shape.** A pinned `TopbarAction` with glyph `✦`, label `AI off`, low priority but pinned so it survives narrow widths. Visible only when no Anthropic credential is configured AND the user previously dismissed the boot prompt (`anthropicSkipped === true`). Click opens `SettingsModal`.
- **`/api/auth/list` payload.** `{ credentials: Credential[] }`, identifier-only. Never includes the secret value. Trusted-but-unset GitHub hosts (from `githubHostTrust.ts`) do **not** appear in this response — they show up in the Settings UI separately (as "add candidates") via a client-side merge of `readTrustedGithubHosts()` and `/auth/list`. v0 polish: just present them in the "Add GitHub host" dropdown's autocomplete.
- **Cleanup of `/api/github/auth/*`.** Hard cut, no aliases. AGENTS.md: "no backwards-compat shims for internal code." Migration is one PR.
- **Migration: existing env-only dev users.** A user who had `ANTHROPIC_API_KEY` in shell env but no Keychain entry will lose access after upgrade until they paste it via the Settings modal. The server logs a one-line warning at startup when it detects `process.env.ANTHROPIC_API_KEY`: "ANTHROPIC_API_KEY is set in the environment but is no longer used; configure via the Settings panel."
- **Migration: existing Tauri Keychain users.** Boot rehydrate handshake (`keychain_get` → `/auth/set`) picks up the existing entry on first launch after upgrade. No re-prompt, no data loss.
- **Eager vs lazy GitHub rehydrate.** Eager at boot: web app iterates `readTrustedGithubHosts()` + `github.com` and pushes each Keychain hit. Cost: a handful of cheap Tauri keychain reads at app start. Benefit: `/api/auth/list` is immediately authoritative, no per-row probe in the Settings UI.
- **Add-host UX without enumeration.** The "Add GitHub host" action is a free-form host input with autocomplete from `readTrustedGithubHosts()`. The host-trust interstitial fires the first time a non-`github.com` host is added.
- **Anthropic skip preservation on clear.** If the user clears the Anthropic credential from Settings, the skip flag is **not** toggled. If they had skipped, the next launch shows no boot prompt (they explicitly chose to be off). If they hadn't skipped, the next launch shows the boot prompt (they removed the key without choosing to be off). Two coherent states; no surprise.
