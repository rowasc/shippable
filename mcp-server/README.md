# @shippable/mcp-server

A TypeScript MCP server that exposes two tools over stdio for the Shippable review loop:

- `shippable_check_review_comments` — pulls pending reviewer feedback from the local Shippable server.
- `shippable_post_review_comment` — posts either a per-comment reply or a fresh top-level comment anchored to the diff, so the reviewer can see what the agent did or noticed.

Both tools talk to the local Shippable server over `127.0.0.1`.

## Magic phrases

Two phrases trigger the round-trip explicitly when prompt drift suppresses the implicit triggers in the tool descriptions:

- **`check shippable`** — pull pending reviewer comments.
- **`report back to shippable`** — post replies (or fresh comments) for what the agent just looked at.

The descriptions were tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback", "let shippable know what you did"). If the agent doesn't pick them up, fall back to the literal phrases.

## Tools

### `shippable_check_review_comments`

Input: `{ worktreePath?: string }` — defaults to the agent's `cwd()`.

Returns the formatted reviewer-feedback envelope, or `"No pending comments."` when the queue is empty. When the envelope is non-empty, the response also carries a short trailing next-step hint reminding the agent to call `shippable_post_review_comment` once per comment — the exact wording lives in `src/handler.ts` (`NEXT_STEP_HINT`) so it stays a single source of truth.

When a queued reviewer comment is of kind `reply-to-agent-comment`, the envelope inlines the parent agent comment's body as a `<parent id="…" file="…" lines="…">…</parent>` child element so the agent has context for its reply. If the parent has aged out of the per-worktree cap, the envelope emits `parent-missing="true"` instead.

### `shippable_post_review_comment`

One tool, two input shapes. Exactly one shape per call:

**Reply mode** — thread under a reviewer comment after addressing it:

- `parentId: string` — the id of the reviewer comment this reply answers (the `id` attribute on the `<comment>` element returned by `shippable_check_review_comments`).
- `outcome: 'addressed' | 'declined' | 'noted'` — what happened:
  - `addressed` — you fixed it.
  - `declined` — you intentionally won't.
  - `noted` — you saw it but no action.
- `replyText: string` — see below.
- `worktreePath?: string` — defaults to the agent's `cwd()`.

**Top-level mode** — leave a proactive comment anchored to the diff:

- `file: string` — repo-relative path your comment is about.
- `lines: string` — `"42"` for a single line or `"40-58"` for a range. File-level (no `lines`) is not supported yet — the reviewer UI has no file-level comment slot.
- `replyText: string` — see below.
- `worktreePath?: string` — defaults to the agent's `cwd()`.

Shared:

- `replyText: string` — free-form prose. Plain text or Markdown; no XML/HTML wrapping needed. (Named `replyText` rather than `body` because some model serializers conflate `body` with HTML's `<body>` element and emit `</body>` close tags into the value. The HTTP wire field on the local Shippable server stays `body` — the rename is contained to the MCP boundary.)

Returns the assigned id on success. Multiple replies to the same `parentId` are allowed and append. Multiple top-level comments on the same `file:lines` are also allowed and append.

## Install

### Claude Code

This package isn't published to npm yet, so the primary install line uses the
local build:

```
claude mcp add shippable -- node /absolute/path/to/mcp-server/dist/index.js
```

Build first (`npm install && npm run build` in `mcp-server/`), then drop the
absolute path to `dist/index.js` into the command above. The Shippable web
panel surfaces this exact line as a click-to-copy chip with the path
pre-filled — server-side resolver picks it up automatically.

Once published — deferred until §7 of `docs/plans/share-review-comments-tasks.md`
— the npx form will work and become the recommended install:

```
# (once @shippable/mcp-server is on npm)
claude mcp add shippable -- npx -y @shippable/mcp-server
```

### Codex CLI

```
# (once published)
codex mcp add shippable -- npx -y @shippable/mcp-server
```

(TODO: verify against current Codex CLI — the exact subcommand has shifted across versions.) Until then, swap the `npx` form for the absolute-path local-build line above.

### Cursor / Cline / Claude Desktop / OpenCode

Add to the harness's MCP config JSON. Until the package is on npm, point at
the absolute path to your local `dist/index.js`:

```json
{
  "mcpServers": {
    "shippable": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"]
    }
  }
}
```

After the npm publish lands, the `command` becomes `"npx"` with
`args: ["-y", "@shippable/mcp-server"]`.

## Configuration

- `SHIPPABLE_PORT` (default `3001`) — the port the local Shippable server is listening on. Override if you've changed `PORT` for `server/`.

The MCP server connects to `http://127.0.0.1:$SHIPPABLE_PORT/api/agent/pull` (for `shippable_check_review_comments`) and `…/api/agent/comments` (for `shippable_post_review_comment`) — localhost only, no LAN exposure.

## Local development

Not yet published; build locally and use the absolute-path install line above.

```
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
