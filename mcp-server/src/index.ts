#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  handleCheckReviewComments,
  handlePostReviewComment,
} from "./handler.js";

const TOOL_DESCRIPTION =
  "Check Shippable for pending reviewer comments. Call this tool when the user mentions reviewing code, pulling reviewer feedback, checking shippable, or asks about review comments. Returns a `<reviewer-feedback>` envelope with one `<comment id=\"…\" file=\"…\" lines=\"…\" kind=\"…\">…</comment>` per pending entry. IMPORTANT: each `<comment>` carries an `id` attribute — you MUST capture it (alongside the body) so you can later report back via `shippable_post_review_comment`. The pending queue is drained on read, so this is the only chance to read the id.";

const POST_COMMENT_DESCRIPTION =
  "Post a comment to Shippable. Two modes through one tool:\n\n" +
  "• Reply: use `parentId` + `outcome` to thread a reply under a reviewer comment after addressing it. `parentId` is the `id` attribute from a `<comment id=\"…\">` returned by `shippable_check_review_comments`. `outcome` is 'addressed' (you fixed it), 'declined' (you intentionally won't), or 'noted' (you saw it but no action). Call this once per comment in the most recent batch, or when the user asks you to 'report back to shippable'.\n\n" +
  "• Top-level: use `file` + `lines` (single `42` or range `40-58`) to leave a proactive comment anchored to the diff. The reviewer sees it as a new entry in the panel they can reply to. Useful when the user asks you to review their diff or to flag something you noticed.\n\n" +
  "Exactly one mode at a time: either (`parentId` + `outcome`) or (`file` + `lines`). Put the prose in `replyText`.";

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
    "shippable_post_review_comment",
    {
      description: POST_COMMENT_DESCRIPTION,
      // Both modes share one schema; the agent supplies exactly one of
      // (`parentId` + `outcome`) or (`file` + `lines`). Per-mode validation
      // and the "neither/both" cases are enforced in the callback below and
      // again on the server. The MCP SDK doesn't expose a discriminated-union
      // record form, so we keep all four mode fields optional.
      inputSchema: {
        parentId: z
          .string()
          .optional()
          .describe(
            "Reply mode. The id of the reviewer comment this reply answers — the `id` attribute of the `<comment>` returned by `shippable_check_review_comments`. Capture it on the first read; the queue drains on pull. Pair with `outcome`.",
          ),
        outcome: z
          .enum(["addressed", "declined", "noted"])
          .optional()
          .describe(
            "Reply mode. Required with `parentId`. What happened with the reviewer's comment: 'addressed' if you fixed it, 'declined' if you intentionally won't, 'noted' if you saw it but no action.",
          ),
        file: z
          .string()
          .optional()
          .describe(
            "Top-level mode. Repo-relative path of the file your comment is about. Pair with `lines`.",
          ),
        lines: z
          .string()
          .optional()
          .describe(
            "Top-level mode. Required with `file`. Either a single line (`42`) or a range (`40-58`). File-level (no `lines`) is not supported yet.",
          ),
        replyText: z
          .string()
          .describe(
            "Free-form prose for the comment or reply. Plain text or Markdown; no XML/HTML wrapping needed.",
          ),
        worktreePath: z
          .string()
          .optional()
          .describe(
            "Absolute path to the worktree this comment belongs to. Defaults to the agent's current working directory.",
          ),
      },
    },
    async ({ parentId, outcome, file, lines, replyText, worktreePath }) => {
      const hasReplyMode = parentId !== undefined && outcome !== undefined;
      const hasTopLevelMode = file !== undefined && lines !== undefined;
      if (hasReplyMode && hasTopLevelMode) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Provide exactly one mode: either (`parentId` + `outcome`) for a reply, or (`file` + `lines`) for a top-level comment.",
            },
          ],
          isError: true,
        };
      }
      if (!hasReplyMode && !hasTopLevelMode) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "Missing required fields. Provide either (`parentId` + `outcome`) for a reply, or (`file` + `lines`) for a top-level comment.",
            },
          ],
          isError: true,
        };
      }
      if (hasReplyMode) {
        return handlePostReviewComment({
          parentId: parentId!,
          outcome: outcome!,
          replyText,
          worktreePath,
        });
      }
      return handlePostReviewComment({
        file: file!,
        lines: lines!,
        replyText,
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
