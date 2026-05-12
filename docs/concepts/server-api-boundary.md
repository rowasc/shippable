# Server API Boundary

## What it is
The HTTP contract between the frontend (and the MCP server) and the local Node backend.

## What it covers today
Grouped by feature. Full request/response shapes live in `web/src/types.ts` and `web/src/definitionTypes.ts`; the server imports them directly so client and server can't drift.

- **Plan & review.** `POST /api/plan` (one-shot AI plan), `POST /api/review` (streaming review, per-IP rate-limited), `GET /api/health`. Plan/review return 503 `{ error: "anthropic_key_missing" }` when no Anthropic credential is configured.
- **Credentials.** `POST /api/auth/{set, clear}` and `GET /api/auth/list`. Generic credential surface. Body shape on `set`/`clear`: `{ credential: { kind: "anthropic" } | { kind: "github", host: string }, value?: string }`. `list` returns `{ credentials: Credential[] }` — identifier-only, never values. The server-side store is in-memory; the web app rehydrates it from the Tauri Keychain at boot. Replaced the older `/api/github/auth/*` endpoints.
- **Definition lookup.** `GET /api/definition/capabilities`, `POST /api/definition`. Backed by `typescript-language-server` for TS/JS and `intelephense`/`phpactor` for PHP; per-language capabilities are tracked in `docs/plans/api-review.md` and `docs/plans/lsp-php.md`.
- **Code graph.** `POST /api/code-graph` — `{ workspaceRoot, ref, scope: "diff"|"repo", files: [{ path, text? }] } → { graph, sources }`. Edges resolved via per-language LSP `documentSymbol` + `references` when available, with regex fallback per file. Backed by `server/src/codeGraph.ts` + the shared `LspClient` in `server/src/lspClient.ts`. See `docs/plans/lsp-code-graph.md`.
- **Prompt library.** `GET /api/library/prompts`, `POST /api/library/refresh` (admin-token-gated).
- **Worktree ingest.** `POST /api/worktrees/{list, changeset, graph, sessions, agent-context, pick-directory}`, `GET /api/worktrees/mcp-status`. POST-with-body is deliberate — paths in URLs cross-platform are a mess.
- **Agent comment queue.** `POST /api/agent/{enqueue, pull, unenqueue}`, `GET /api/agent/delivered?path=…`. Drives the MCP server's `shippable_check_review_comments` tool.
- **GitHub PR ingest.** `POST /api/github/pr/load` — accepts a PR URL, fetches diff + metadata + review comments from GitHub (or GHE), returns a complete `ChangeSet` with `prSource` provenance. `POST /api/github/pr/branch-lookup` — resolves a worktree's current branch to an open upstream PR, enabling the worktree↔PR overlay pill. Per-host PATs come from the generic `/api/auth/*` surface above. Both endpoints plug into the same `classifyRequestOrigin` + opaque-origin denial path as every other endpoint. Design rationale: `docs/sdd/gh-connectivity/spec.md` and `docs/sdd/api-key-flows-refinement/spec.md`.

## Properties worth knowing

- **Backend is a hard dependency.** The web app probes `/api/health` at boot and refuses to load without it. Worktree ingest, the prompt library, and the AI plan all live here; there is no browser-only fallback. Don't reintroduce one.
- **Origin enforcement is mandatory.** Every request goes through `classifyRequestOrigin` + `classifyFetchSite` — `Origin: null` (sandboxed iframes, opaque redirects) is always denied. See the comment block in `server/src/index.ts:854` before touching CORS.
- **Errors are unstructured today.** Every error body is `{ error: string }`. Adding optional `code` for machine-readable error classification is in `docs/plans/api-review.md`.
- **Definition status is double-encoded.** The endpoint returns both an HTTP code and a `status` discriminator. Resolution is tracked in `docs/plans/api-review.md` (#3).
- **Body keys aren't fully consistent.** `/api/worktrees/*` uses `{ path }`; `/api/agent/*` uses `{ worktreePath }`. Same value, two names — also in the API review.

## Where to find it
- Implementation: `server/src/index.ts`.
- Type contracts: `web/src/types.ts`, `web/src/definitionTypes.ts`.
- README user-facing reference: top of `README.md` under "Backend".
- Open design questions: `docs/plans/api-review.md`.
