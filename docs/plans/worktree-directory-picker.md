# Worktree directory picker

## Status: shipped

Both Welcome and LoadModal lead with `Choose folder…` and keep manual entry as a fallback. Tauri uses `@tauri-apps/plugin-dialog`; browser/dev calls `POST /api/worktrees/pick-directory` (wired at `server/src/index.ts:81` → `worktrees.pickDirectory`). Shared state machine lives in `web/src/useWorktreeLoader.ts` (chosen over the `worktreePicker.ts` alternative). The Tauri sidecar starts without an Anthropic key, so worktree loading no longer requires AI config.

The remainder of this doc is the original plan.

---

The worktree ingest flow exists today, but the first step is still wrong: both the welcome screen and the load modal ask the user to paste an absolute path. That is brittle, easy to mistype, and inconsistent with the rest of the product. This plan replaces the raw-path-first UX with an explicit directory chooser where the runtime can actually return a filesystem path, while keeping a boring fallback where it cannot.

## Why this needs its own plan

There are three concrete constraints in the current code:

- `web/src/components/Welcome.tsx` and `web/src/components/LoadModal.tsx` both call `/api/worktrees/list` with a string `dir`, then `/api/worktrees/changeset` with a string `path`. The current flow is path-based end to end.
- `server/src/worktrees.ts` validates that `dir` is an absolute path pointing at a real git directory before it shells out to `git worktree list --porcelain`.
- `src-tauri/src/lib.rs` only starts the sidecar when an Anthropic key is present, even though the worktree and health endpoints do not require one.

That means a folder picker is not just a button. The runtime has to hand back a real path, and the desktop app has to expose the sidecar even when AI is unavailable.

## Goals

- Let the user choose a directory instead of typing or pasting a path.
- Auto-scan immediately after a successful pick.
- Reuse the existing `/api/worktrees/list` and `/api/worktrees/changeset` endpoints instead of inventing a second ingest path.
- Treat the server-backed path as the default product shape.
- Remove the accidental dependency on an Anthropic key for desktop worktree loading.

## Non-goals

- Reworking how worktrees are listed or how diffs are parsed.
- Adding commit-range picking in the same slice.
- Building a server-side native file picker for every browser/dev platform.
- Supporting memory-only deployments. This feature still requires disk.

## Constraints and evidence

### Tauri can return a real directory path

Tauri's dialog plugin supports directory selection and returns filesystem paths on desktop platforms. It also supports `defaultPath`, which matches the current "remember last directory" behavior and avoids dropping the user back at home every time.

Source:

- Tauri dialog plugin docs: `open({ directory: true, multiple: false, defaultPath })` and "file dialog APIs returns file system paths on Linux, Windows and macOS."

### Browser directory inputs do not solve the same problem

The browser's `webkitdirectory` input can enumerate a folder's contents, but the browser exposes relative paths for the selected files (`webkitRelativePath`), not the absolute directory path the current server API expects. That makes it the wrong primitive for the existing worktree flow unless we redesign ingestion around uploading file trees, which is out of scope here.

Source:

- MDN `HTMLInputElement.webkitdirectory`
- MDN `File.webkitRelativePath`

## Product design

### User flow

In surfaces that already expose worktree loading:

1. The user sees a primary `Choose folder…` button.
2. Picking a folder immediately populates the remembered directory state and triggers the existing worktree scan.
3. The chosen path remains visible as plain text beneath the button so the user can verify where they are.
4. A secondary `Paste path instead` affordance keeps the manual escape hatch for failures, odd setups, or users who already have the path on hand.
5. Cancelling the picker is a no-op, not an error state.

Once the scan completes, the worktree list behaves exactly as it does now.

### Copy and hierarchy

The current copy says "From a worktrees directory". That is too specific and nudges users toward `.claude/worktrees/` even though a repo root works too. Replace it with `Choose a local repo or worktrees folder`.

The path field should stop being the first thing the user sees. It becomes:

- hidden behind `Paste path instead` in normal use
- still available in both Tauri and browser as an escape hatch

### Shared UI

`Welcome` and `LoadModal` currently duplicate the worktree-loading state machine. That duplication is how UX drift happens. The picker slice should extract a shared unit, either:

- `web/src/components/WorktreeLoader.tsx`, if the UI should be shared directly
- `web/src/useWorktreeLoader.ts`, if the state machine should be shared and the two screens should keep slightly different markup

Either is fine. The important part is one implementation of:

- health/capability probe
- remembered directory state
- scan request
- load-changeset request
- error copy

## Capability model

This should stay explicit.

### Tauri desktop

Supported. Use the native directory picker.

Implementation shape:

- add `@tauri-apps/plugin-dialog` to `web/`
- add `tauri-plugin-dialog` to `src-tauri/`
- register the plugin in `src-tauri/src/lib.rs`
- call `open({ directory: true, multiple: false, defaultPath })` from the frontend

### Browser + local server

Supported. Browser should also get a chooser-first flow.

But the chooser should live on the server side, not in a browser-only file-system experiment. The current worktree flow already expects a directory path string at `/api/worktrees/list`, and the server is already the component that touches disk and shells out to `git`. Keep that boundary intact.

Implementation shape:

- add `POST /api/worktrees/pick-directory`
- the server opens a host-native folder chooser
- the endpoint returns `{ path: string }` on success or `{ cancelled: true }` on cancel
- the frontend feeds that path into the existing worktree scan flow

Why this is the saner browser design:

- it preserves the existing server contract
- it returns a real filesystem path, which the current git-backed endpoints already need
- it avoids coupling worktree ingest to File System Access API support, secure-context requirements, or browser-specific handle semantics

Browser-side directory APIs like `showDirectoryPicker()` are real and useful, but they are the wrong first move for this feature because they change the integration boundary instead of just fixing the UX.

### Browser only / no server

Not worth optimizing for. If that mode is going away, this feature should not carry extra complexity to preserve it.

## Architecture changes

### 1. Decouple sidecar startup from the Anthropic key

This is the unglamorous blocker. The desktop app should start the sidecar regardless of whether the key exists. The server already guards `/api/plan` and `/api/review` individually and can return `503` there. Worktree loading should not be collateral damage.

Change:

- `src-tauri/src/lib.rs`: always spawn the sidecar
- when no key exists, omit `ANTHROPIC_API_KEY` from the sidecar env instead of skipping startup entirely

Result:

- `apiUrl("/api/health")` and `/api/worktrees/*` stay available in desktop mode without AI configured

### 2. Add a frontend picker adapter

Create a small runtime-aware helper, for example `web/src/worktreePicker.ts`:

- `pickDirectory(options): Promise<string | null>`
- in Tauri: lazy-import `@tauri-apps/plugin-dialog` and return the selected path
- in browser: call `/api/worktrees/pick-directory` and return the chosen path
- on cancel: return `null`

This keeps runtime-specific code out of the view components and gives both server-backed surfaces the same chooser-first UX.

### 3. Keep manual entry as fallback, not default

The shared worktree loader should expose:

- `Choose folder…` button in all server-backed environments
- manual path input behind `Paste path instead`

That gives us:

- Tauri: chooser-first UX, manual fallback
- browser+server: chooser-first UX, manual fallback

This is intentionally boring. One user-facing interaction, two runtime adapters.

### 4. Preserve the existing localStorage contract

Keep `shippable.worktreesDir` as the remembered directory key. Feed it into Tauri's `defaultPath` so the next picker opens where the user last worked.

No migration is needed.

## Suggested implementation slices

### Slice 1: desktop unblock

- Start the sidecar without requiring an Anthropic key.
- Verify that `/api/health` and `/api/worktrees/list` respond in the desktop app with no key configured.

Done when:

- the worktree loader renders in Tauri without an API key

### Slice 2: chooser-first UX

- Add the Tauri dialog plugin.
- Add the server-side picker endpoint for browser use.
- Add the shared frontend picker adapter.
- Add `Choose folder…` to the shared worktree loader.
- Auto-scan on successful selection.

Done when:

- a Tauri user can open the app, click one button, pick a repo/worktrees folder, and land on the worktree list without typing a path
- a browser-dev user can do the same thing against the local server

### Slice 3: cleanup and tests

- Extract shared worktree loader logic from `Welcome` and `LoadModal`.
- Add frontend tests for:
  - cancel does nothing
  - successful pick sets the path and triggers scan
  - fallback path input still works when picker fails

Done when:

- the two surfaces no longer duplicate the state machine

## Risks

- Adding the picker only in one surface will create immediate UX drift.
- Leaving sidecar startup tied to the Anthropic key will make the feature look broken in desktop even if the picker itself works.
- A browser-only directory-handle flow will look attractive but it changes the ingest boundary. If we only need a chooser, prefer a server-opened native dialog that returns the same path shape the existing API already uses.

## Files likely touched

- `web/package.json`
- `web/src/components/Welcome.tsx`
- `web/src/components/LoadModal.tsx`
- `web/src/components/LoadModal.css`
- `web/src/worktreePicker.ts` or `web/src/useWorktreeLoader.ts`
- `server/src/worktrees.ts` or a sibling picker module
- `server/src/index.ts`
- `src-tauri/Cargo.toml`
- `src-tauri/src/lib.rs`

## Success criteria

- Desktop users can choose a directory without typing a path.
- Browser-dev users can choose a directory without typing a path.
- The same flow works from both the welcome screen and the load modal.
- Worktree loading works without an Anthropic key in the desktop app.
- Manual path entry remains available as fallback instead of being the primary path.
