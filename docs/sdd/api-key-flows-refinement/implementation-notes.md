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

### 3a. Task 20 had no code change (modal was already presentational)
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

### 3. Server callsite migration happened in Task 4, not Task 5
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

### 4. `http.ts` extracted from `index.ts` to share `readBody`/CORS helpers
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

### 5. `Demo.tsx` / `feature-docs.tsx` migration happened inside Task 15
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

### 6. ReviewWorkspace's PR refresh code path was also migrated
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
