# @shippable/mcp-server

A TypeScript MCP server that exposes `shippable_check_review_comments` over stdio. It pulls pending reviewer feedback from the local Shippable server and hands it back as the tool result.

## Magic phrase

Tell your agent: **`check shippable`**

The tool description was tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback", "check shippable"). If the agent doesn't pick it up, fall back to the literal phrase.

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

The MCP server connects to `http://127.0.0.1:$SHIPPABLE_PORT/api/agent/pull` — localhost only, no LAN exposure.

## Local development

Not yet published; build locally and use the absolute-path install line above.

```
npm install
npm run build      # tsc → dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```
