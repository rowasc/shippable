#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  handleCheckReviewComments,
  handlePostReviewReply,
} from "./handler.js";

const TOOL_DESCRIPTION =
  "Check Shippable for pending reviewer comments. Call this tool when the user mentions reviewing code, pulling reviewer feedback, checking shippable, or asks about review comments. Returns a `<reviewer-feedback>` envelope with one `<comment id=\"…\" file=\"…\" lines=\"…\" kind=\"…\">…</comment>` per pending entry. IMPORTANT: each `<comment>` carries an `id` attribute — you MUST capture it (alongside the body) so you can later report back via `shippable_post_review_reply`. The pending queue is drained on read, so this is the only chance to read the id.";

const POST_REPLY_DESCRIPTION =
  "Post a structured reply to a Shippable reviewer comment after addressing it. Call this tool once per comment in the most recent shippable batch — outcome 'addressed' (you fixed it), 'declined' (you intentionally won't), or 'noted' (you saw it but no action). The `commentId` is the `id` attribute from the `<comment id=\"…\">` element returned by `shippable_check_review_comments`. Put your reply prose in `replyText`. Also call when the user asks you to 'report back to shippable' or similar.";

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

  server.registerTool(
    "shippable_post_review_reply",
    {
      description: POST_REPLY_DESCRIPTION,
      inputSchema: {
        commentId: z
          .string()
          .describe(
            "The id of the reviewer comment this reply answers. This is the `id` attribute of the `<comment>` element returned by `shippable_check_review_comments` — capture it on the first read; the queue drains on pull.",
          ),
        replyText: z
          .string()
          .describe(
            "Free-form prose explaining what you did (or didn't do) for this comment. Plain text or Markdown; no XML/HTML wrapping needed.",
          ),
        outcome: z
          .enum(["addressed", "declined", "noted"])
          .describe(
            "What happened with this comment: 'addressed' if you fixed it, 'declined' if you intentionally won't, 'noted' if you saw it but no action.",
          ),
        worktreePath: z
          .string()
          .optional()
          .describe(
            "Absolute path to the worktree the reply belongs to. Defaults to the agent's current working directory.",
          ),
      },
    },
    async ({ commentId, replyText, outcome, worktreePath }) => {
      return handlePostReviewReply({
        commentId,
        replyText,
        outcome,
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
