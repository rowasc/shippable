#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  handleCheckReviewComments,
  handlePostReviewReply,
} from "./handler.js";

const TOOL_DESCRIPTION =
  "Check Shippable for pending reviewer interactions. Call this tool when the user mentions reviewing code, pulling reviewer feedback, checking shippable, or asks about review comments. Returns a `<reviewer-feedback>` envelope with one `<interaction id=\"…\" target=\"…\" intent=\"…\" author=\"…\" authorRole=\"…\" file=\"…\" lines=\"…\">…</interaction>` per pending entry. IMPORTANT: each `<interaction>` carries an `id` attribute — you MUST capture it (alongside the body) so you can later report back via `shippable_post_review_reply`. The pending queue is drained on read, so this is the only chance to read the id.";

const POST_REPLY_DESCRIPTION =
  "Post a structured reply to a Shippable reviewer interaction after addressing it. Call this tool once per interaction in the most recent shippable batch — intent 'accept' (you agreed and will do or have done it), 'reject' (you disagree and won't), or 'ack' (you saw it but no commitment either way). The `parentId` is the `id` attribute from the `<interaction id=\"…\">` element returned by `shippable_check_review_comments`. Put your reply prose in `replyText`. Also call when the user asks you to 'report back to shippable' or similar.";

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
            "Absolute path to the worktree whose review interactions should be fetched. Defaults to the agent's current working directory.",
          ),
      },
    },
    async ({ worktreePath }) => {
      return handleCheckReviewComments({ worktreePath });
    },
  );

  server.registerTool(
    "shippable_post_review_reply",
    {
      description: POST_REPLY_DESCRIPTION,
      inputSchema: {
        parentId: z
          .string()
          .describe(
            "The id of the reviewer interaction this reply answers. This is the `id` attribute of the `<interaction>` element returned by `shippable_check_review_comments` — capture it on the first read; the queue drains on pull.",
          ),
        replyText: z
          .string()
          .describe(
            "Free-form prose explaining what you did (or didn't do) for this interaction. Plain text or Markdown; no XML/HTML wrapping needed.",
          ),
        intent: z
          .enum(["accept", "reject", "ack"])
          .describe(
            "What happened with this interaction: 'accept' if you agreed and acted on it, 'reject' if you disagree and won't, 'ack' if you saw it but no commitment either way.",
          ),
        worktreePath: z
          .string()
          .optional()
          .describe(
            "Absolute path to the worktree the reply belongs to. Defaults to the agent's current working directory.",
          ),
      },
    },
    async ({ parentId, replyText, intent, worktreePath }) => {
      return handlePostReviewReply({
        parentId,
        replyText,
        intent,
        worktreePath,
      });
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
