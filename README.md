# shippable

Shippable is an early **prototype** of an AI-assisted code review tool that accompanies you as you work through a diff. Shippable helps you figure out where to start, highlights how things relate to each other, and keeps track of you've already reviewed.

![shippable demo](docs/all.gif)

The code itself is a throwaway at this point, meant to explore a concept. Please don't use this in any kind of production setting.

## Running it

There are two packages: `web/` (the React app) and `server/` (a tiny Node backend that calls the Claude API for AI-generated review plans). For the AI plan you need both running; without `server/` the UI falls back to a rule-based plan.

### Frontend (`web/`)

```
cd web
nvm use           # picks up Node from .nvmrc (22). fnm/asdf read it too.
npm install
npm run dev       # Vite dev server (proxies /api → server on :3001)
npm run build     # tsc -b && vite build — the canonical "did I break typing" check
npm run lint      # eslint
npm run preview   # serve the production build
```

There's no test runner wired up yet. `npm run build` is the typecheck for now.

### Backend (`server/`)

The backend is optional. If it isn't running, the UI falls back to the rule-based plan.

```
cd server
npm install
```

Set `ANTHROPIC_API_KEY` in your shell before starting the server. On macOS, store it in the system Keychain once and pull it into your shell before starting:

```
security add-generic-password -s shippable -a ANTHROPIC_API_KEY -w
export ANTHROPIC_API_KEY=$(security find-generic-password -s shippable -a ANTHROPIC_API_KEY -w)
npm run dev        # tsx watch on http://127.0.0.1:3001
npm run typecheck  # tsc --noEmit
```

The bundled desktop app reads from the same Keychain entry, so this one setup serves both surfaces.

The backend listens on `http://127.0.0.1:3001` and allows these browser origins by default:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

If you want a different browser-origin allowlist, set:

```
export SHIPPABLE_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

The single endpoint is `POST /api/plan` — accepts `{ changeset: ChangeSet }`, returns `{ plan: ReviewPlan }`. The model defaults to `claude-sonnet-4-6`; override by setting `CLAUDE_MODEL` in the same shell.

Three entry points:

- `/` is the live app.
- `/gallery.html` is a screen catalog that renders every UI state against canned fixtures. This is the intended surface for design work — way faster than driving the live app with the keyboard to reach an edge case.
- `?cs=<id>` on the main app jumps straight to a specific sample ChangeSet, which is handy if you need to reproduce a fixture state manually.

## Building the desktop app

Shippable can also ship as a native macOS app. The React frontend gets wrapped in a [Tauri 2](https://tauri.app/) shell, and `server/` gets compiled to a standalone binary via [`bun build --compile`](https://bun.sh/docs/bundler/executables) and bundled inside the .app — so the .dmg is self-contained, no Node or browser dev server required at runtime.

### One-time setup

```
brew tap oven-sh/bun && brew install bun
cargo install tauri-cli --version "^2.0"
(cd server && bun install)
(cd web && npm install)
```

### Build

```
(cd server && bun run build:sidecar)   # compile the backend to src-tauri/binaries/
cargo tauri build                       # bundle frontend + sidecar into .app + .dmg
```

Output:

- `src-tauri/target/release/bundle/macos/Shippable.app`
- `src-tauri/target/release/bundle/dmg/Shippable_0.1.0_aarch64.dmg`

`cargo tauri build` does **not** invoke `bun run build:sidecar` — re-run it manually whenever you change anything in `server/src/`.

The .dmg is unsigned, so first launch trips macOS Gatekeeper — right-click the .app in Finder → Open → confirm once. Subsequent launches don't prompt.

### First launch

If no Anthropic API key is in the Keychain, the app shows a setup modal where you can paste one. The key is stored at `service=shippable, account=ANTHROPIC_API_KEY` in your login Keychain (same entry the dev backend uses). Quit and relaunch after saving — the bundled backend is spawned at app startup, so it only picks up new keys on the next run.

Remove a saved key with:

```
security delete-generic-password -s shippable -a ANTHROPIC_API_KEY
```

### Iterating

For quick iteration on the Rust shell or the frontend, `cargo tauri dev` runs the React app via Vite in a native window with hot reload. The bundled-sidecar path still applies — if `src-tauri/binaries/shippable-server-aarch64-apple-darwin` is missing, the app launches but AI plans fail. Either run `bun run build:sidecar` once before `cargo tauri dev`, or run the standalone `server/` separately and stick to the browser dev flow above.
