#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleCheckReviewComments } from "./handler.js";

const TOOL_DESCRIPTION =
  "Check Shippable for pending reviewer comments. Call this tool when the user mentions reviewing code, pulling reviewer feedback, checking shippable, or asks about review comments.";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "@shippable/mcp-server",
    version: "0.0.0",
  });

  server.registerTool(
    "shippable_check_review_comments",
    {
      description: TOOL_DESCRIPTION,
      inputSchema: {
        worktreePath: z
          .string()
          .optional()
          .describe(
            "Absolute path to the worktree whose review comments should be fetched. Defaults to the agent's current working directory.",
          ),
      },
    },
    async ({ worktreePath }) => {
      return handleCheckReviewComments({ worktreePath });
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[shippable-mcp-server] fatal:", err);
  process.exit(1);
});
