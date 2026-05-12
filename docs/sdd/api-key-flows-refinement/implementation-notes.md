# Implementation Notes — API Key Flows Refinement

Deviations and notes captured during execution of the 25-task plan in
`docs/sdd/api-key-flows-refinement/plan.md`.

## Deviations

### 1. `server/src/auth/encode.ts` collapsed into `credential.ts`
- **Spec said:** Tasks 1 + 2 implied two modules — `server/src/auth/credential.ts`
  (or `encode.ts`) for the type and the `encodeStoreKey/decodeStoreKey`
  helpers, plus `server/src/auth/store.ts` for the runtime map. The
  spec's File Changes table listed `encode.ts` separately.
- **What was done:** The `Credential` type and both encoders live in a
  single file, `server/src/auth/credential.ts`. The plan's Task 1
  filename matched this.
- **Why:** Splitting a 30-line module across two files added file-count
  cost without clarity. The encoders are tightly bound to the type.
- **Impact:** None functional. Anyone looking for `encode.ts` should
  find it next to its only consumer in `credential.ts`.

### 2. `web/src/auth/useCredentials.ts` is `.tsx`, not `.ts`
- **Spec/plan said:** Task 11 named the file `web/src/auth/useCredentials.ts`.
- **What was done:** The file is `useCredentials.tsx` because it exports
  a `CredentialsProvider` React component alongside the hook.
- **Why:** The web project's `tsconfig` uses `"jsx": "react-jsx"`; JSX
  is not allowed in `.ts` files. Splitting the provider into a third
  file just to keep the hook in `.ts` was not worth the indirection.
- **Impact:** Consumers import `from "./auth/useCredentials"` (no
  extension), so the rename is invisible.

### 3. Task 20 had no code change (modal was already presentational)
- **Spec/plan said:** Task 20 was to update `GitHubTokenModal.tsx` so its
  submit "calls `useCredentials().set` rather than the legacy
  `setGithubToken` path" — but also noted "If the modal already takes
  `onSubmit` as a prop, no change here; the caller's `onSubmit`
  implementation changes in Task 21."
- **What was done:** The modal already accepts `onSubmit(host, token)`
  from its caller and never imports `setGithubToken` itself, so no
  change was required. The caller migration (the one the plan really
  wanted) lives in Task 21. No separate Task 20 commit was made.
- **Impact:** None.

### 4. Server callsite migration happened in Task 4, not Task 5
- **Spec/plan said:** Task 5 was to migrate `server/src/github/api-client.ts`
  to read from the new auth-store via `getCredential({kind:"github", host})`.
- **What was done:** `api-client.ts` does not (and never did) call the
  auth-store directly — it accepts a `token` parameter from its caller.
  The actual callsites that read the store are in `server/src/index.ts`
  (`handleGithubPrLoad` and `handleGithubPrBranchLookup`), and those
  were swapped to `getCredential({kind:"github", host})` in Task 4
  rather than Task 5, because Task 4's test seeding (which now writes
  via `/api/auth/set` to the *new* store) would otherwise fail against
  reads still pointed at the *old* store.
- **Why:** Splitting Task 4 (route change) from Task 5 (read migration)
  would have left the integration tests red between commits, which the
  TDD discipline forbade. Bundling kept every commit's quality gate
  green.
- **Impact:** Task 5 had no remaining code change. To keep the commit
  log aligned with the plan, no separate "Task 5" commit was made.
  The Task 5 verification step ("grep `from \"./auth-store\"` in
  `server/src/github/` returns no references") still holds — there were
  none to begin with.

### 5. `http.ts` extracted from `index.ts` to share `readBody`/CORS helpers
- **Spec/plan said:** Task 3 said to "use the existing `readBody`,
  `writeCorsHeaders` … from `server/src/index.ts`".
- **What was done:** Extracted `MAX_REQUEST_BODY_BYTES`,
  `RequestBodyTooLargeError`, `readBody`, and `writeCorsHeaders` into a
  new `server/src/http.ts` module. Both `index.ts` and the new
  `auth/endpoints.ts` import from there. No behaviour change.
- **Why:** Either the new module had to re-implement the helpers (drift
  risk) or the helpers had to live where both modules could see them.
  Extraction was the cleaner fix and is one of the boring solutions
  `AGENTS.md` calls out as preferred.
- **Impact:** One new file (`server/src/http.ts`), 30 LOC moved. No
  behaviour change.

### 6. `Demo.tsx` / `feature-docs.tsx` migration happened inside Task 15
- **Spec/plan said:** Task 15 was a straight deletion of
  `web/src/useApiKey.ts`, `web/src/components/KeySetup.tsx`, and
  `KeySetup.css`. The Verify step said "`grep useApiKey|KeySetup` …
  returns zero references" before deletion.
- **What was done:** Those greps found two consumers outside the boot
  gate — `web/src/feature-docs.tsx` and `web/src/components/Demo.tsx`
  — that imported `KeySetup` to stage screenshots/demo frames. Both
  were migrated to render `<CredentialsPanel mode="boot">` wrapped in
  a fresh `<CredentialsProvider>`. The deletion then went through clean.
- **Why:** Required to land the deletion without breaking the build.
- **Impact:** Demo and feature-docs surfaces now exercise the same
  panel the boot gate does, which is the desired end state.

### 7. ReviewWorkspace's PR refresh code path was also migrated
- **Spec/plan said:** Task 21 covered `useGithubPrLoad.ts`.
- **What was done:** `ReviewWorkspace.tsx` carries a *duplicate* of the
  same cache-hit / token-required logic in `handlePrRefresh` /
  `handlePrRefreshTokenSubmit` (used by the PR-refresh button). Both
  were also rerouted through `useCredentials().set` to keep behaviour
  symmetric and to let Task 22 (delete `setGithubToken`) land cleanly.
- **Why:** Leaving the duplicate pointing at the soon-to-be-deleted
  `setGithubToken` would have broken Task 22's build.
- **Impact:** The PR refresh flow now writes via the unified credentials
  hook. End-user behaviour unchanged.

## Post-implementation review fixes

A multi-agent review (architecture, design, UI/UX, bugs, security, code
reuse, general) ran after the initial 25 tasks landed. The findings
below are the ones acted on before the branch shipped. Each is captured
because the spec did not anticipate them.

### R1. `CredentialsProvider` hoisted to `main.tsx`
- **What changed:** The provider was mounted inside `App`, below the
  `ServerHealthGate` that wraps `App`. The gate calls `useCredentials()`
  on every render, so production threw on first paint. Tests masked
  this because each test wrapped its own provider. Hoisting the
  provider above the gate in `main.tsx` fixes it.
- **Why the spec missed it:** Task 12 said "Wrap the existing app body
  in `<CredentialsProvider>`" — literally accurate, but the gate's
  consumption of `useCredentials()` (added in Task 14) made the gate
  itself a consumer that the wrapper didn't cover.
- **Impact:** Production no longer crashes at boot. `App.test.tsx`
  updated to wrap with `<CredentialsProvider>` to mirror `main.tsx`.

### R2. Mount-time fetch race collapsed into a single rehydrate
- **What changed:** `CredentialsProvider` previously ran a standalone
  `useEffect` calling `refresh()`; `AppBody` ran a *second* effect
  calling `rehydrate()` (which itself ended with `refresh()`). On Tauri
  cold start the two could resolve out of order, briefly showing the
  boot Anthropic panel to users who actually had a Keychain entry.
  Now the provider's mount effect is the only fetcher: `rehydrate()`
  runs once, the `isTauri()` branch guards only the Keychain reads,
  and `refresh()` runs in both modes so `status` flips to "ready"
  exactly once. `ServerHealthGate` also waits on
  `credentials.status !== "loading"` before deciding which branch to
  render, so the boot panel cannot flash while the initial fetch is
  in flight.

### R3. Anthropic env-fallback closed in JS and Rust
- **What changed (server):** `plan.ts` and `review.ts` previously
  passed `apiKey: getCredential(...)` directly to `new Anthropic(...)`,
  which silently falls back to `process.env.ANTHROPIC_API_KEY` when
  the value is `undefined`. The route-level gate prevents this in
  normal flow, but a TOCTOU (concurrent `/api/auth/clear` between gate
  and SDK construction) could slip through. Both call sites now throw
  `anthropic_key_missing` when `getCredential` returns falsy.
- **What changed (Tauri):** The sidecar spawn used to set
  `.env("ANTHROPIC_API_KEY", "")` defensively (so the parent shell's
  exported key couldn't shadow the Keychain-backed flow). That clear
  was removed alongside the Keychain read in Task 23; the env path
  was reopened. Restored as a one-line `.env("ANTHROPIC_API_KEY", "")`
  on the sidecar `Command`.

### R4. Two cache-hit retry paths now use `keychainAccountFor`
- **What changed:** `web/src/useGithubPrLoad.ts` and
  `web/src/components/ReviewWorkspace.tsx` built the Keychain account
  name inline as `` `GITHUB_TOKEN:${host}` ``. The helper introduced in
  Task 9 (`keychainAccountFor`) was added precisely to prevent this
  drift. Both call sites now funnel through it; the inline strings
  also skipped the helper's host normalization, so a server response
  with a mixed-case host could write under one account and read back
  under another.

### R5. `SettingsModal` exposes dialog ARIA attributes
- **What changed:** The modal's `modal__box` got `role="dialog"`,
  `aria-modal="true"`, `aria-label="settings"`. The boot gate and the
  existing `GitHubTokenModal` already had this triplet; the new modal
  silently dropped it.

### R6. Github host normalized once, at the HTTP boundary
- **What changed:** `parseCredential` in `server/src/auth/endpoints.ts`
  preserved the raw host string while `encodeStoreKey` and
  `assertGithubHostAllowed` independently re-normalized. The store
  handled this correctly, but `/api/auth/list` reflected the canonical
  form via `decodeStoreKey` — so callers could write under
  `GitHub.Com` and read back `github.com`, an asymmetric API surface.
  Now `parseCredential` normalizes once and the Credential carries the
  canonical form for the entire request.

### R7. `/api/auth/has` dropped
- **What changed:** The endpoint had no caller — every consumer (Settings
  UI, boot gate, tests) reads from `/api/auth/list` and derives presence
  via `list.some(...)`. Keeping `has` half-wired meant maintaining a
  POST endpoint whose only effect was the same information `list`
  already exposes, with a worse REST shape. Dropped from
  `server/src/auth/endpoints.ts`, the route in `server/src/index.ts`,
  the `authHas` wrapper in `web/src/auth/client.ts`, and all related
  tests. `docs/concepts/server-api-boundary.md` updated; the SDD spec
  was left as a record of original intent.

### R8. Host blocklist coverage
- **What changed:** Added `0.0.0.0` (IPv4 unspecified, resolves to
  loopback on connect) and `::ffff:` (IPv4-mapped IPv6 — the kernel
  translates these so a caller using the prefix could otherwise bypass
  the IPv4 blocklist). Tests now also exercise `::1`, `172.16.0.1` /
  `172.31.255.254` boundaries, `100.64.0.1` / `100.127.255.254` CGNAT
  boundaries, and `fc00::`.

### R9. Nits — error message + retained duplication
- `assertGithubHostAllowed` previously echoed the offending host in its
  `Error.message`. `handleAuthSet` catches the throw and returns the
  bare `host_blocked` discriminator, but a future logger could surface
  `.message` verbatim. The error message no longer includes the host.
- The `AddGithubHost` sub-component in `CredentialsPanel.tsx` overlaps
  with `GitHubTokenModal`'s host-trust + token-paste staging. Extracting
  a shared `<HostTrustConfirmation>` was considered but skipped:
  `AddGithubHost` has a third stage (host input) the modal does not,
  and they use different CSS namespaces (`.creds__*` vs `.modal__*`).
  The duplication is deliberate at the prototype stage; revisit once
  a third surface (e.g. PR-load preflight) needs the same staging.

## Manual smoke steps the headless harness cannot run

These remain pending for a human (or a Tauri-capable environment):

1. **Cargo check / cargo test for `src-tauri`** — the executing
   environment has no Rust toolchain. `src-tauri/src/lib.rs` was
   edited (Anthropic Keychain read + env-seed removed); please run
   `cd src-tauri && cargo check && cargo test` before merging.
2. **Tauri smoke** (Task 25 step 2):
   - Cold-start `npm run tauri:dev` with an existing Anthropic Keychain
     entry → confirm no boot prompt; AI plan works without restart.
   - Open Settings → Clear the Anthropic row → relaunch → boot prompt
     reappears.
   - Click "Skip — use rule-based only" → topbar shows the "AI off"
     chip; relaunch stays quiet; chip click opens Settings.
3. **GitHub smoke** (Task 25 step 3):
   - Paste a github.com PR URL → token modal → save → load succeeds.
   - Open Settings → Rotate the github.com row → no restart needed.
   - Click "Add GitHub host" with a synthetic GHE host → host-trust
     interstitial fires → save → entry appears in the list.
4. **Dev smoke** (Task 25 step 4):
   - `cd web && npm run dev` + `cd server && npm run dev` (no Tauri).
   - Settings modal accepts the Anthropic key (paste path, no shell
     export expected); AI plan works.
   - Tokens lost on server restart (acceptable per spec).
5. **Startup warning** (Task 8 verify):
   - Run the server with `ANTHROPIC_API_KEY` set in the env → confirm
     the single-line "no longer used; configure via the Settings panel"
     warning prints.
   - Run without it → confirm nothing extra is logged.
