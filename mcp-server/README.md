# @shippable/mcp-server

A TypeScript MCP server that exposes two tools over stdio for the Shippable review loop:

- `shippable_check_review_comments` — pulls pending reviewer feedback from the local Shippable server.
- `shippable_post_review_reply` — posts a structured per-comment reply back so the reviewer sees what the agent did with each note.

Both tools talk to the local Shippable server over `127.0.0.1`.

## Magic phrases

Two phrases trigger the round-trip explicitly when prompt drift suppresses the implicit triggers in the tool descriptions:

- **`check shippable`** — pull pending reviewer comments.
- **`report back to shippable`** — post replies for the comments the agent just addressed.

The descriptions were tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback", "let shippable know what you did"). If the agent doesn't pick them up, fall back to the literal phrases.

## Tools

### `shippable_check_review_comments`

Input: `{ worktreePath?: string }` — defaults to the agent's `cwd()`.

Returns the formatted reviewer-feedback envelope, or `"No pending comments."` when the queue is empty. When the envelope is non-empty, the response also carries a short trailing next-step hint reminding the agent to call `shippable_post_review_reply` once per comment — the exact wording lives in `src/handler.ts` (`NEXT_STEP_HINT`) so it stays a single source of truth.

### `shippable_post_review_reply`

Input:
- `commentId: string` — the id of the reviewer comment this reply answers (the `id` attribute on the `<comment>` element returned by `shippable_check_review_comments`).
- `replyText: string` — free-form prose explaining what you did. Plain text or Markdown; no XML/HTML wrapping needed. (Named `replyText` rather than `body` because some model serializers conflate `body` with HTML's `<body>` element and emit `</body>` close tags into the value.)
- `outcome: 'addressed' | 'declined' | 'noted'` — what happened with the comment:
  - `addressed` — you fixed it.
  - `declined` — you intentionally won't.
  - `noted` — you saw it but no action.
- `worktreePath?: string` — defaults to the agent's `cwd()`.

Returns the assigned reply id on success. Multiple replies to the same `commentId` are allowed and append.

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

The MCP server connects to `http://127.0.0.1:$SHIPPABLE_PORT/api/agent/pull` (for `shippable_check_review_comments`) and `…/api/agent/replies` (for `shippable_post_review_reply`) — localhost only, no LAN exposure.

## Local development

Not yet published; build locally and use the absolute-path install line above.

```
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
