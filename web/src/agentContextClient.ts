// Thin client over the agent-context endpoints. See server/src/agent-context.ts
// and docs/concepts/agent-context.md for the design.

import { getJson, postJson } from "./apiClient";
import type {
  AgentComment,
  AgentContextSlice,
  AgentSessionRef,
  CommentKind,
  DeliveredComment,
} from "./types";

export async function listSessionsForWorktree(
  worktreePath: string,
): Promise<AgentSessionRef[]> {
  const { sessions } = await postJson<{ sessions: AgentSessionRef[] }>(
    "/api/worktrees/sessions",
    { path: worktreePath },
  );
  return sessions;
}

export async function fetchMcpStatus(): Promise<{
  installed: boolean;
  /**
   * The `claude mcp add …` command the panel chip should display + copy.
   * Authoritative — comes from the server's path resolver so the chip
   * surfaces a working command even before `@shippable/mcp-server` lands
   * on npm. See `resolveInstallCommand` in `server/src/mcp-status.ts`.
   */
  installCommand: string;
}> {
  return getJson<{ installed: boolean; installCommand: string }>(
    "/api/worktrees/mcp-status",
  );
}

export async function fetchAgentContext(args: {
  worktreePath: string;
  sessionFilePath: string;
  commitSha?: string | null;
}): Promise<AgentContextSlice> {
  const { slice } = await postJson<{ slice: AgentContextSlice }>(
    "/api/worktrees/agent-context",
    {
      path: args.worktreePath,
      sessionFilePath: args.sessionFilePath,
      commitSha: args.commitSha ?? null,
    },
  );
  return slice;
}

// ── Agent comment queue (slice 2) ────────────────────────────────────────
// Thin wrappers over /api/agent/{enqueue,unenqueue,delivered}. The pull
// endpoint is consumed by the MCP server (slice 3), not the web client.

export async function enqueueComment(args: {
  worktreePath: string;
  commitSha: string;
  comment: {
    kind: CommentKind;
    file: string;
    lines?: string;
    body: string;
    supersedes?: string | null;
    /**
     * Required when `kind === "reply-to-agent-comment"`; links the reviewer's
     * reply to its parent top-level `AgentComment`. The server validates the
     * id against the worktree's agent-comment store and inlines the parent's
     * body in the pull envelope so the agent has context for its response.
     */
    parentAgentCommentId?: string;
  };
}): Promise<{ id: string }> {
  return postJson<{ id: string }>("/api/agent/enqueue", {
    worktreePath: args.worktreePath,
    commitSha: args.commitSha,
    comment: args.comment,
  });
}

export async function unenqueueComment(args: {
  worktreePath: string;
  id: string;
}): Promise<{ unenqueued: boolean }> {
  return postJson<{ unenqueued: boolean }>("/api/agent/unenqueue", {
    worktreePath: args.worktreePath,
    id: args.id,
  });
}

export async function fetchDelivered(
  worktreePath: string,
): Promise<DeliveredComment[]> {
  const { delivered } = await getJson<{ delivered: DeliveredComment[] }>(
    `/api/agent/delivered?path=${encodeURIComponent(worktreePath)}`,
  );
  return delivered;
}

/**
 * Fetch the worktree's agent-authored entries. The response mixes both
 * reply-shaped (with `parent`) and top-level-shaped (with `anchor`) entries;
 * the caller splits them by discriminator in `state.ts`.
 */
export async function fetchAgentComments(
  worktreePath: string,
): Promise<AgentComment[]> {
  const { comments } = await getJson<{ comments: AgentComment[] }>(
    `/api/agent/comments?worktreePath=${encodeURIComponent(worktreePath)}`,
  );
  return comments;
}

/**
 * Convenience: list sessions for a worktree, pick the most recent that
 * matches, fetch its slice for the given commit. Returns null when no
 * matching session exists. The session picker can override this default
 * by passing `pinnedSessionFilePath`.
 */
export async function fetchAgentContextForWorktree(args: {
  worktreePath: string;
  commitSha: string;
  pinnedSessionFilePath?: string | null;
}): Promise<{
  slice: AgentContextSlice;
  candidates: AgentSessionRef[];
} | null> {
  // Dirty views carry a synthetic `dirty:<hash>` marker as commitSha. There's
  // no commit to slice agent context against, and passing the marker through
  // would surface the server's "invalid commit sha" error in the right panel.
  if (args.commitSha.startsWith("dirty:")) return null;
  const candidates = await listSessionsForWorktree(args.worktreePath);
  if (candidates.length === 0) return null;
  const session =
    (args.pinnedSessionFilePath
      ? candidates.find((c) => c.filePath === args.pinnedSessionFilePath)
      : null) ?? candidates[0];
  const slice = await fetchAgentContext({
    worktreePath: args.worktreePath,
    sessionFilePath: session.filePath,
    commitSha: args.commitSha,
  });
  return { slice, candidates };
}
