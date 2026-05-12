# Implementation Plan: API Key Flows Refinement

Based on: `docs/sdd/api-key-flows-refinement/spec.md`

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

## Tasks

### Task 1: Server credential types + storeKey encoding
- **Files**: `server/src/auth/credential.ts` (new), `server/src/auth/credential.test.ts` (new)
- **Do**:
  1. Write failing tests in `credential.test.ts`:
     - `encodeStoreKey({kind:"anthropic"})` returns `"anthropic"`.
     - `encodeStoreKey({kind:"github", host:"GitHub.Com"})` returns `"github:github.com"` (lowercased).
     - `encodeStoreKey` for github kind throws on empty host.
     - `decodeStoreKey("anthropic")` returns `{kind:"anthropic"}`.
     - `decodeStoreKey("github:ghe.foo")` returns `{kind:"github", host:"ghe.foo"}`.
     - `decodeStoreKey` throws on unknown prefix.
  2. Run `cd server && npm test -- credential` — verify tests fail.
  3. Implement `Credential` type and `encodeStoreKey`/`decodeStoreKey` in `credential.ts`. Host normalization: lowercase + trim.
  4. Run tests — verify pass.
  5. Commit: `feat(server/auth): add Credential type and storeKey encoding`
- **Verify**: `credential.test.ts` passes; `npm run typecheck` in `server/` passes.
- **Depends on**: none

### Task 2: Generic server-side auth-store
- **Files**: `server/src/auth/store.ts` (new), `server/src/auth/store.test.ts` (new)
- **Do**:
  1. Write failing tests in `store.test.ts`:
     - Roundtrip: `setCredential({kind:"anthropic"}, "sk-...")` then `hasCredential` returns `true`; `getCredential` returns the value; `clearCredential` removes.
     - Roundtrip for `{kind:"github", host:"github.com"}`.
     - `listCredentials()` returns all configured credentials in stable order.
     - `setCredential` for blocked github hosts (`localhost`, `127.0.0.1`, `10.0.0.1`, `192.168.1.1`, `169.254.169.254`, `fe80::1`, `fd00::1`) throws.
     - `setCredential` for `{kind:"anthropic"}` is **not** subject to host blocklist (no host).
     - `resetForTests()` clears all entries.
  2. Run tests — verify fail.
  3. Implement `store.ts`. Import `BLOCKED` regexes from `server/src/github/auth-store.ts` (or copy them — see Task 6 for deletion). Key the internal Map by `encodeStoreKey(credential)`. Apply blocklist only when `credential.kind === "github"`.
  4. Run tests — verify pass.
  5. Commit: `feat(server/auth): generic credential store with host blocklist`
- **Verify**: `store.test.ts` passes.
- **Depends on**: Task 1

### Task 3: Endpoint handlers
- **Files**: `server/src/auth/endpoints.ts` (new), `server/src/auth/endpoints.test.ts` (new)
- **Do**:
  1. Write failing tests in `endpoints.test.ts`:
     - `POST /api/auth/set` with `{credential:{kind:"anthropic"}, value:"sk-..."}` returns 200 `{ok:true}` and writes to store.
     - `POST /api/auth/set` with `{credential:{kind:"github", host:"github.com"}, value:"ghp_..."}` writes to store.
     - `POST /api/auth/has` with `{credential:{kind:"anthropic"}}` returns `{present:false}` when empty; `{present:true}` after set.
     - `POST /api/auth/clear` removes the entry.
     - `GET /api/auth/list` returns `{credentials: Credential[]}` — no values.
     - Validation: missing `credential` → 400 `{error:"invalid_credential"}`. Missing `value` on `/set` → 400 `{error:"missing_value"}`. Blocked github host → 400 `{error:"host_blocked"}`.
  2. Run tests — verify fail.
  3. Implement four exported handler functions (`handleAuthSet`, `handleAuthHas`, `handleAuthClear`, `handleAuthList`). Use the existing `readBody`, `writeCorsHeaders`, and structured-error pattern from `server/src/index.ts`. Validate via discriminator parse before delegating to `store.ts`.
  4. Run tests — verify pass.
  5. Commit: `feat(server/auth): /api/auth/{set,has,clear,list} handlers`
- **Verify**: `endpoints.test.ts` passes; handlers exported from `endpoints.ts`.
- **Depends on**: Task 2

### Task 4: Wire endpoints into router; drop `/api/github/auth/*`
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Add failing tests in `index.test.ts`:
     - `POST /api/auth/set` routes through the origin-classification path; opaque-origin / disallowed origin still rejected.
     - `POST /api/github/auth/set` (and `has`, `clear`) returns 404 (no longer registered).
  2. Run tests — verify fail.
  3. In `index.ts`: import the four new handlers; register their routes in the request dispatcher; **remove** the three `/api/github/auth/*` route registrations and the `handleGithubAuthSet`/`Has`/`Clear` imports.
  4. Run tests — verify pass.
  5. Commit: `feat(server): wire /api/auth/*, drop /api/github/auth/*`
- **Verify**: `index.test.ts` passes; grep `/api/github/auth` in `server/src/` returns no live references.
- **Depends on**: Task 3

### Task 5: Migrate `github/api-client.ts` to new store
- **Files**: `server/src/github/api-client.ts`, `server/src/github/api-client.test.ts`
- **Do**:
  1. Update existing tests in `api-client.test.ts` to write tokens via `setCredential({kind:"github", host}, value)` from `server/src/auth/store.ts` instead of the old `github/auth-store.ts`. Run — verify they fail against the unmigrated client.
  2. In `api-client.ts`: replace any `authStore.getToken(host)` (or equivalent) call with `getCredential({kind:"github", host})` from `server/src/auth/store.ts`. The signature and behavior at call sites stay identical (still returns `string | undefined`).
  3. Run tests — verify pass.
  4. Commit: `refactor(server/github): read tokens from auth/store`
- **Verify**: `api-client.test.ts` passes; grep `from "./auth-store"` in `server/src/github/` returns no references.
- **Depends on**: Task 2

### Task 6: Delete `server/src/github/auth-store.ts` and its tests
- **Files**: `server/src/github/auth-store.ts` (delete), `server/src/github/auth-store.test.ts` (delete)
- **Do**:
  1. `grep -rn "github/auth-store" server/src/` — confirm no remaining imports.
  2. Delete both files.
  3. Run `cd server && npm run typecheck && npm test`.
  4. Commit: `chore(server): remove obsolete github/auth-store`
- **Verify**: typecheck + tests pass.
- **Depends on**: Tasks 4, 5

### Task 7: Replace `ANTHROPIC_API_KEY` env-checks with auth-store reads
- **Files**: `server/src/index.ts`, `server/src/plan.ts`, `server/src/review.ts`, `server/src/index.test.ts`
- **Do**:
  1. Add failing tests in `index.test.ts`:
     - `POST /api/plan` returns 503 `{error:"anthropic_key_missing"}` when no anthropic credential is in the store.
     - After `POST /api/auth/set {credential:{kind:"anthropic"},value:"sk-..."}`, the next `POST /api/plan` no longer 503s (mock the Anthropic SDK call to avoid hitting the network).
     - Same pair for `POST /api/review`.
  2. Run tests — verify fail.
  3. In `server/src/index.ts`: replace the `process.env.ANTHROPIC_API_KEY` env checks in `handlePlan` (line ~188) and `handleReview` (line ~258) with `getCredential({kind:"anthropic"})`. Drop the `ANTHROPIC_API_KEY not set on the server` error string; use the `anthropic_key_missing` discriminator.
  4. In `server/src/plan.ts` (`new Anthropic()` at line ~84) and `server/src/review.ts` (`new Anthropic()` at line ~70): change to `new Anthropic({ apiKey: getCredential({kind:"anthropic"}) })`. The SDK previously read the key from `process.env` implicitly; with env-seeding gone (Task 23) we have to pass it explicitly. Both files only run when the gate confirmed the credential is present, so the value is guaranteed non-null at the call site.
  5. Run tests — verify pass.
  6. Commit: `refactor(server): AI endpoints consult auth-store instead of env`
- **Verify**: tests pass; grep `process.env.ANTHROPIC_API_KEY` in `server/src/` returns at most one site (the startup-warning log, handled in Task 8).
- **Depends on**: Task 4

### Task 8: Collapse `/api/health` payload + startup warning
- **Files**: `server/src/index.ts`, `server/src/index.test.ts`
- **Do**:
  1. Update test in `index.test.ts`: `GET /api/health` returns `{ok:true}` — no `anthropic` field.
  2. Run — verify fail.
  3. In `index.ts`: change the `/api/health` handler payload (line ~149–157). Also drop the now-stale comment block at lines ~1714–1718 ("The web gate surfaces the missing-key state via /api/health") and replace the startup warning at line ~1720: when `process.env.ANTHROPIC_API_KEY` is set, log a single line — "`[server] ANTHROPIC_API_KEY is set in the environment but is no longer used; configure via the Settings panel.`". When unset, log nothing — Anthropic absence is normal and the web gate handles it.
  4. Run tests — verify pass.
  5. Commit: `refactor(server): minimal /api/health; warn on stale env var`
- **Verify**: `/api/health` test passes; manual: starting the server with `ANTHROPIC_API_KEY` set prints the warning; starting without prints nothing extra.
- **Depends on**: Task 7

### Task 9: Web credential types + `keychainAccountFor`
- **Files**: `web/src/auth/credential.ts` (new), `web/src/auth/credential.test.ts` (new)
- **Do**:
  1. Write failing tests:
     - `keychainAccountFor({kind:"anthropic"})` returns `"ANTHROPIC_API_KEY"`.
     - `keychainAccountFor({kind:"github", host:"github.com"})` returns `"GITHUB_TOKEN:github.com"`.
     - `keychainAccountFor({kind:"github", host:"GHE.Foo"})` returns `"GITHUB_TOKEN:ghe.foo"` (normalized).
  2. Run `cd web && npm test -- credential` — verify fail.
  3. Implement `Credential` type and `keychainAccountFor` in `credential.ts`.
  4. Run — verify pass.
  5. Commit: `feat(web/auth): Credential type and keychain account mapping`
- **Verify**: tests pass; `npm run typecheck` in `web/` passes.
- **Depends on**: none

### Task 10: Auth fetch client
- **Files**: `web/src/auth/client.ts` (new), `web/src/auth/client.test.ts` (new)
- **Do**:
  1. Write failing tests using fetch mocks:
     - `authSet(c, value)` POSTs `{credential:c, value}` to `/api/auth/set`.
     - `authHas(c)` POSTs `{credential:c}` and returns `boolean` from `{present}`.
     - `authClear(c)` POSTs and returns void.
     - `authList()` GETs `/api/auth/list` and returns the `credentials` array.
     - Non-2xx with body `{error:"..."}` throws `AuthClientError` with `discriminator` field.
  2. Run — verify fail.
  3. Implement four functions and the `AuthClientError` class. Mirror `web/src/githubPrClient.ts`'s error-handling style.
  4. Run — verify pass.
  5. Commit: `feat(web/auth): client wrappers for /api/auth/*`
- **Verify**: tests pass.
- **Depends on**: Task 9

### Task 11: `useCredentials` hook + `CredentialsContext`
- **Files**: `web/src/auth/useCredentials.ts` (new), `web/src/auth/useCredentials.test.tsx` (new)
- **Do**:
  1. Write failing tests using `@testing-library/react` + mocks for `authList`/`authSet`/`authClear` and the Tauri `keychainGet`/`Set`/`Remove`:
     - On mount in Tauri mode: `rehydrate()` calls `keychainGet('ANTHROPIC_API_KEY')` + `keychainGet('GITHUB_TOKEN:<host>')` for each trusted host + `github.com`. For each hit, calls `authSet`. Misses don't prompt (silent).
     - `set(credential, value)` calls `keychainSet` (Tauri) + `authSet`; refreshes `list`.
     - `set({kind:"anthropic"}, …)` also clears `localStorage["shippable:anthropic:skip"]`.
     - `clear(c)` calls `keychainRemove` + `authClear`; refreshes `list`.
     - `skipAnthropic()` writes `localStorage["shippable:anthropic:skip"] = "true"`. `anthropicSkipped` reflects the flag.
     - Non-Tauri: `rehydrate()` is a no-op (no Tauri commands invoked); `set`/`clear` only call the server (no Keychain).
  2. Run — verify fail.
  3. Implement `useCredentials` hook and `CredentialsContext`. Use `isTauri()` from `web/src/keychain.ts`. The Tauri keychain commands stay in `web/src/keychain.ts` (no change).
  4. Run — verify pass.
  5. Commit: `feat(web/auth): useCredentials hook + context`
- **Verify**: tests pass.
- **Depends on**: Task 10

### Task 12: Wire `CredentialsProvider` in App.tsx
- **Files**: `web/src/App.tsx`, `web/src/App.test.tsx` (likely modify)
- **Do**:
  1. Add failing test: `App` mounts with a working `useCredentials()` context (consumer test component sees the expected initial `status: "loading"` then `"ready"`).
  2. Run — verify fail.
  3. Wrap the existing app body in `<CredentialsProvider>`. Add a `useEffect` that calls `rehydrate()` once on mount (`useCredentials().rehydrate()` — the provider exposes it; only runs Tauri keychain reads if `isTauri()`).
  4. Run — verify pass.
  5. Commit: `feat(web): mount CredentialsProvider; rehydrate on app start`
- **Verify**: test passes; `npm run build` succeeds.
- **Depends on**: Task 11

### Task 13: `CredentialsPanel` component
- **Files**: `web/src/components/CredentialsPanel.tsx` (new), `web/src/components/CredentialsPanel.css` (new), `web/src/components/CredentialsPanel.test.tsx` (new)
- **Do**:
  1. Write failing tests:
     - `mode="boot"`: renders only the Anthropic row, with a save input + a "Skip — use rule-based only" button. Skip calls `skipAnthropic()`.
     - `mode="settings"`: renders Anthropic + every GitHub host row, plus an "Add GitHub host" button. No Skip button.
     - Rotate: clicking opens an inline edit; submitting calls `useCredentials().set(c, value)`.
     - Clear: calls `useCredentials().clear(c)`.
     - "Add GitHub host" with a non-`github.com` host triggers the host-trust interstitial (`trustGithubHost` flow from `githubHostTrust.ts`) before the token input.
  2. Run — verify fail.
  3. Implement `CredentialsPanel.tsx` consuming `useCredentials()`. Reuse `GitHubTokenModal`'s host-trust UI logic (`isGithubDotCom`, `readTrustedGithubHosts`, `trustGithubHost`) for the Add flow. Copy/migrate styles from `KeySetup.css` into `CredentialsPanel.css`.
  4. Run — verify pass.
  5. Commit: `feat(web): CredentialsPanel for boot + settings`
- **Verify**: tests pass.
- **Depends on**: Task 11

### Task 14: `ServerHealthGate` refactor
- **Files**: `web/src/components/ServerHealthGate.tsx`, `web/src/components/ServerHealthGate.test.tsx` (likely new)
- **Do**:
  1. Write failing tests:
     - Server reachable + anthropic in `list` → renders `children`.
     - Server reachable + anthropic missing + `anthropicSkipped` false → renders `<CredentialsPanel mode="boot" />`.
     - Server reachable + anthropic missing + `anthropicSkipped` true → renders `children` (skip suppresses the gate).
     - Server unreachable → renders the existing "Server unreachable" copy + retry.
     - The `waitForSidecarReady()` step from `apiUrl.ts` still runs before any auth check (test asserts the Rust→web `shippable:sidecar-ready` event is awaited).
  2. Run — verify fail.
  3. Rewrite `ServerHealthGate.tsx`: drop `useApiKey` import + `KeySetup` import + the `serverKey`/`shellSkipped`/`mode="shell"` machinery. Consume `useCredentials()` for the anthropic-presence check. **Preserve** the `waitForSidecarReady()` call that landed in commit `10d11cd` — it must run before the `/api/health` probe and before reading the credentials list, otherwise we race the sidecar boot. `/api/health` is still hit for liveness; the response is treated as `{ok:true}` (no `anthropic` field expected post-Task 8).
  4. Run — verify pass.
  5. Commit: `refactor(web): ServerHealthGate consumes useCredentials`
- **Verify**: tests pass; manual Tauri smoke: cold start still waits for sidecar listener.
- **Depends on**: Tasks 12, 13

### Task 15: Delete `useApiKey.ts`, `KeySetup.tsx`, `KeySetup.css`
- **Files**: `web/src/useApiKey.ts` (delete), `web/src/components/KeySetup.tsx` (delete), `web/src/components/KeySetup.css` (delete)
- **Do**:
  1. `grep -rn "useApiKey\|KeySetup" web/src/` — confirm zero references.
  2. Delete the three files.
  3. Run `cd web && npm run typecheck && npm run lint && npm test`.
  4. Commit: `chore(web): remove obsolete useApiKey + KeySetup`
- **Verify**: typecheck + lint + tests pass.
- **Depends on**: Task 14

### Task 16: `SettingsModal` frame
- **Files**: `web/src/components/SettingsModal.tsx` (new), `web/src/components/SettingsModal.test.tsx` (new)
- **Do**:
  1. Write failing tests:
     - Renders into `document.body` via portal.
     - Backdrop click invokes `onClose`.
     - Esc key invokes `onClose`.
     - Contains `<CredentialsPanel mode="settings" />`.
  2. Run — verify fail.
  3. Implement. Mirror `GitHubTokenModal`'s portal + backdrop pattern. Reuse `LoadModal.css` modal styles.
  4. Run — verify pass.
  5. Commit: `feat(web): SettingsModal wrapping CredentialsPanel`
- **Verify**: tests pass.
- **Depends on**: Task 13

### Task 17: Topbar `settings` action
- **Files**: `web/src/App.tsx` (or wherever the workspace topbar composes its `TopbarAction[]`), `web/src/App.test.tsx`
- **Do**:
  1. Write failing test: workspace topbar exposes a `settings` action (id, label `settings`, glyph ⚙); clicking it opens the `SettingsModal`.
  2. Run — verify fail.
  3. Add a `settings` `TopbarAction` (low priority, not pinned — fine to drop into the overflow kebab at narrow widths) to the existing action list; wire `onClick` to a local `showSettings` boolean that conditionally renders `<SettingsModal onClose={...} />`.
  4. Run — verify pass.
  5. Commit: `feat(web): topbar settings action opens SettingsModal`
- **Verify**: test passes.
- **Depends on**: Task 16

### Task 18: Topbar `AI off` chip
- **Files**: `web/src/App.tsx` (same composition site as Task 17), `web/src/App.test.tsx`
- **Do**:
  1. Write failing tests:
     - When `useCredentials().list` has no `anthropic` entry AND `anthropicSkipped` is `true`: topbar renders a pinned `ai-off` action (glyph ✦, label `AI off`); click opens `SettingsModal`.
     - When Anthropic is configured: chip is absent.
     - When Anthropic is missing but `anthropicSkipped` is false: chip is absent (boot gate is showing instead).
  2. Run — verify fail.
  3. Add a conditional `ai-off` `TopbarAction` (pinned: true, low priority but pinned so it survives narrow widths) into the action list when the derived condition holds.
  4. Run — verify pass.
  5. Commit: `feat(web): topbar 'AI off' chip when anthropic dismissed`
- **Verify**: tests pass.
- **Depends on**: Task 17

### Task 19: Welcome `settings` link
- **Files**: `web/src/components/Welcome.tsx`, `web/src/components/Welcome.test.tsx`
- **Do**:
  1. Write failing test: Welcome renders a `settings` link/button; clicking opens `SettingsModal`.
  2. Run — verify fail.
  3. Add a small text-link in Welcome's footer area; manage `showSettings` state locally; render the modal portal.
  4. Run — verify pass.
  5. Commit: `feat(web): settings affordance on Welcome screen`
- **Verify**: test passes.
- **Depends on**: Task 16

### Task 20: `GitHubTokenModal` submit via `useCredentials`
- **Files**: `web/src/components/GitHubTokenModal.tsx`, `web/src/components/GitHubTokenModal.test.tsx`
- **Do**:
  1. Update existing tests: `onSubmit` now calls `useCredentials().set({kind:"github", host}, token)` rather than the legacy `setGithubToken` path.
  2. Run — verify fail.
  3. Inject `useCredentials` (or rely on `onSubmit` being supplied by the caller — the modal stays presentational; the call-site change is in `useGithubPrLoad` per Task 21). If the modal already takes `onSubmit` as a prop, no change here; the caller's `onSubmit` implementation changes in Task 21.
  4. If a real change is needed in this file (any direct `setGithubToken` import), remove it.
  5. Run — verify pass.
  6. Commit: `refactor(web): GitHubTokenModal submits through useCredentials path`
- **Verify**: tests pass.
- **Depends on**: Task 11

### Task 21: `useGithubPrLoad` cache-hit via `useCredentials`
- **Files**: `web/src/useGithubPrLoad.ts`, `web/src/useGithubPrLoad.test.ts` (if present; else create coverage)
- **Do**:
  1. Write/update failing tests:
     - On `github_token_required`, if Keychain has the host, the cache-hit retry path now calls `useCredentials().set({kind:"github", host}, cached)` (which performs keychainSet + /auth/set) before retrying the PR load — equivalent end state, one orchestrating call.
     - On `submitToken`, the modal's submit calls `useCredentials().set(...)` (same path).
  2. Run — verify fail.
  3. In `useGithubPrLoad.ts`: replace the direct `keychainGet` + `setGithubToken` sequence with `useCredentials().set(...)` from context. `keychainGet` lookup stays on the cache-hit path (since `set` requires the value to be already known); only the *write* path collapses.
  4. Run — verify pass.
  5. Commit: `refactor(web): useGithubPrLoad writes via useCredentials`
- **Verify**: tests pass; reactive PR flow still works end-to-end in dev.
- **Depends on**: Tasks 11, 20

### Task 22: Delete `setGithubToken` from `githubPrClient.ts`
- **Files**: `web/src/githubPrClient.ts`, `web/src/githubPrClient.test.ts`
- **Do**:
  1. `grep -rn "setGithubToken" web/src/` — confirm no remaining call sites (after Tasks 20–21).
  2. Delete the exported `setGithubToken` function from `githubPrClient.ts`; remove its test if any.
  3. Run `cd web && npm run typecheck && npm run lint && npm test`.
  4. Commit: `chore(web): drop setGithubToken; auth/client.ts owns it`
- **Verify**: typecheck + lint + tests pass.
- **Depends on**: Task 21

### Task 23: Tauri shell — drop Anthropic Keychain read + env-seed
- **Files**: `src-tauri/src/lib.rs`
- **Do**:
  1. Edit `start_sidecar`: remove the `keychain::get(ANTHROPIC_KEY_ACCOUNT)` block (lines ~47–70 from the read above) including its `log::warn!`/`log::info!` calls. Remove the `.env("ANTHROPIC_API_KEY", key.unwrap_or_default())` line on the sidecar `Command`. Remove the now-unused `ANTHROPIC_KEY_ACCOUNT` const if it has no other readers (it doesn't).
  2. `cd src-tauri && cargo check` — verify the build still compiles.
  3. Run the existing keychain unit tests: `cargo test`.
  4. Commit: `refactor(tauri): sidecar no longer reads anthropic key at spawn`
- **Verify**: `cargo check` + `cargo test` pass; manual: `npm run tauri:dev` boots, web app's rehydrate handshake picks up the existing Keychain entry, AI plan still works without restart.
- **Depends on**: Task 12 (web rehydrate is in place before the sidecar stops reading)

### Task 24: Documentation updates
- **Files**: `docs/concepts/server-api-boundary.md`, `docs/architecture.md`, `README.md`
- **Do**:
  1. `docs/concepts/server-api-boundary.md`: replace the `/api/github/auth/*` section with `/api/auth/*`; document the body shapes from spec.md "Wire shapes".
  2. `docs/architecture.md`: update the credential-flow section to describe the unified pattern (web-app-orchestrated; Tauri-shell-Keychain-client; server holds runtime state).
  3. `README.md`: drop the `export ANTHROPIC_API_KEY=…` instruction in the dev section; replace with a one-line "paste your key in the Settings panel (or at first launch)" pointer.
  4. Commit: `docs: update for unified credential flow`
- **Verify**: docs render; grep `/api/github/auth/` in `docs/` returns no live references.
- **Depends on**: Tasks 8, 22, 23

### Task 25: End-to-end smoke + cleanup pass
- **Files**: none (or follow-up fixes)
- **Do**:
  1. Run full suite: `cd web && npm run build && npm run lint && npm test && cd ../server && npm run typecheck && npm test`.
  2. Manual Tauri smoke: launch `npm run tauri:dev` with an existing Keychain entry — Anthropic prompt does NOT appear; AI plan works without restart. Then clear via Settings → boot prompt reappears next launch. Then Skip → topbar shows "AI off"; subsequent launches stay quiet.
  3. Manual GitHub smoke: paste a github.com PR URL → token modal → save → load succeeds. Open Settings → rotate the github.com row → no restart needed. Add a (synthetic) GHE host via Settings → host-trust interstitial shows → save → entry appears in the list.
  4. Manual dev smoke: `cd web && npm run dev` + `cd server && npm run dev` (no Tauri) → no shell-export instructions; Settings modal accepts the Anthropic key; AI plan works; tokens lost on server restart (acceptable per spec).
  5. If smoke surfaces gaps, fix in this task with focused commits.
  6. Commit (if needed): `fix(api-keys): <specific>`
- **Verify**: all of the above pass.
- **Depends on**: Task 24
