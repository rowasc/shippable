# @shippable/mcp-server

A TypeScript MCP server that exposes `shippable_check_review_comments` over stdio. It pulls pending reviewer feedback from the local Shippable server and hands it back as the tool result.

## Magic phrase

Tell your agent: **`check shippable`**

The tool description was tuned for prompt drift on adjacent phrasings ("pull review comments", "any reviewer feedback", "check shippable"). If the agent doesn't pick it up, fall back to the literal phrase.

## Install

### Claude Code

```
claude mcp add shippable -- npx -y @shippable/mcp-server
```

For a not-yet-published checkout, install from the local build:

```
claude mcp add shippable -- node /absolute/path/to/mcp-server/dist/index.js
```

### Codex CLI

```
codex mcp add shippable -- npx -y @shippable/mcp-server
```

(TODO: verify against current Codex CLI — the exact subcommand has shifted across versions.)

### Cursor / Cline / Claude Desktop / OpenCode

Add to the harness's MCP config JSON:

```json
{
  "mcpServers": {
    "shippable": {
      "command": "npx",
      "args": ["-y", "@shippable/mcp-server"]
    }
  }
}
```

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
