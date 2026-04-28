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

Set `ANTHROPIC_API_KEY` in your shell before starting the server. On macOS, one reasonable setup is:

```
security add-generic-password -a "$USER" -s anthropic-key-shippable -w
export ANTHROPIC_API_KEY=$(security find-generic-password -s anthropic-key-shippable -w)
npm run dev        # tsx watch on http://127.0.0.1:3001
npm run typecheck  # tsc --noEmit
```

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
